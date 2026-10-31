import type { Exchange, WalletBalance } from "./bitfinex.js";
import type { BotConfig, BotState } from "./config.js";
import { BTC_UST, XAUT_BTC, XAUT_UST, convertToUst, otherSymbol, raiseUst, rotate, sweepUst } from "./execute.js";
import {
  RELIABLE_BARS,
  buildTrades,
  computeLarsson,
  invertCandles,
  replaySignals,
  type DailyCandle,
  type LarssonBar,
} from "./larsson.js";
import type { Store } from "./store.js";

/** Full history so the Larsson lines converge exactly like TradingView (Bitfinex allows up to 10,000). */
export const CANDLE_LIMIT = 5000;

// ---------------------------------------------------------------- analysis

export interface Analysis {
  /** Inverted (BTC priced in XAUT) bars with Larsson lines. */
  bars: LarssonBar[];
  signals: ReturnType<typeof replaySignals>["signals"];
  /** The strategy wants to hold BTC (true) or XAUT (false), after the strategy entry cap. */
  desiredBtc: boolean;
  /** Same without the strategy cap, for the dashboard. */
  desiredBtcUncapped: boolean;
  /** Last confirmed bar with a regime. */
  last: { regime: "orange" | "navy" | "gray"; dist: number | null; time: number } | null;
  warmup: boolean;
}

/** Pure: candles (XAUT/BTC, as the exchange quotes them) -> what the strategy wants now. */
export function analyze(rawXautBtc: DailyCandle[], cfg: BotConfig, now: number): Analysis {
  const bars = computeLarsson(invertCandles(rawXautBtc), now);
  const cap = cfg.strategyCap.enabled ? cfg.strategyCap.maxDistPct : null;
  const capped = replaySignals(bars, cap);
  const plain = cap === null ? capped : replaySignals(bars, null);
  const lastBar = [...bars].reverse().find((b) => b.confirmed && b.regime !== null) ?? null;
  return {
    bars,
    signals: capped.signals,
    desiredBtc: capped.holdingBtc,
    desiredBtcUncapped: plain.holdingBtc,
    last: lastBar ? { regime: lastBar.regime!, dist: lastBar.dist, time: lastBar.time } : null,
    warmup: bars.length < RELIABLE_BARS,
  };
}

export function tradesFor(a: Analysis) {
  const lastClose = a.bars[a.bars.length - 1]?.close ?? null;
  return buildTrades(a.signals, lastClose);
}

// ---------------------------------------------------------------- planning

export interface WalletView {
  xaut: number;
  btc: number;
  xautAvail: number;
  btcAvail: number;
  ustAvail: number;
  /** Balances in anything other than BTC, XAUT and USDT (USD, other coins). */
  others?: Array<{ currency: string; available: number }>;
}

export function walletView(w: WalletBalance[]): WalletView {
  const get = (c: string) => w.find((x) => x.currency === c);
  const ust = w.filter((x) => x.currency === "UST" || x.currency === "USDT").reduce((s, x) => s + x.availableBalance, 0);
  return {
    xaut: get("XAUT")?.balance ?? 0,
    btc: get("BTC")?.balance ?? 0,
    xautAvail: get("XAUT")?.availableBalance ?? 0,
    btcAvail: get("BTC")?.availableBalance ?? 0,
    ustAvail: ust,
    others: w
      .filter((x) => !(["BTC", "XAUT", "UST", "USDT"] as string[]).includes(x.currency) && !x.currency.startsWith("TEST") && x.availableBalance > 0)
      .map((x) => ({ currency: x.currency, available: x.availableBalance })),
  };
}

/** USDT the bot keeps parked: the USDT reserve, limited to the value of the XAUT reserve, and 0 while the XAUT reserve is off. */
export function usdtTargetOf(cfg: { xautReserve: number; usdtReserve: number }, usdPerXaut: number): number {
  if (!(cfg.xautReserve > 0)) return 0;
  return Math.min(Math.max(0, cfg.usdtReserve), cfg.xautReserve * usdPerXaut);
}

/** USDT that counts as part of the account value: the parked reserve plus leftovers of the bot's own rotations. */
export function parkedUst(w: { ustAvail: number }, cfg: { xautReserve: number; usdtReserve: number }, strandedUst: number, usdPerXaut: number): number {
  return Math.min(w.ustAvail, usdtTargetOf(cfg, usdPerXaut) + Math.max(0, strandedUst));
}

export interface PlanInput {
  cfg: BotConfig;
  state: BotState;
  wallets: WalletView;
  /** BTC per XAUT. */
  price: number;
  usdPerXaut: number;
  usdPerBtc: number;
  desiredBtc: boolean;
  /** Distance of BTC (in XAUT) above its Larsson baseline, as a fraction; null while warming up. */
  dist: number | null;
  /** USD value of each "other" balance (filled in by runTick). */
  others?: Array<{ currency: string; available: number; usd: number }>;
}

export interface DepositFound {
  asset: "XAUT" | "BTC";
  /** Positive = deposit, negative = withdrawal. */
  amount: number;
  valueXaut: number;
  action: string;
}

export type PlannedAction =
  | { kind: "none"; why: string }
  | { kind: "sweep"; into: "btc" | "xaut"; ust: number; idle?: boolean }
  | { kind: "raise_usdt"; usd: number; base: number }
  | { kind: "reserve_xaut"; btc: number }
  | { kind: "convert_other"; currency: string; amount: number; usd: number }
  | { kind: "to_btc"; xaut: number }
  | { kind: "to_xaut"; btc: number };

export interface Plan {
  deposits: DepositFound[];
  heldBackXaut: number;
  clearStranded: boolean;
  action: PlannedAction;
  notes: string[];
}

/**
 * Pure planning step. Detects wallet changes the bot did not cause (deposits and
 * withdrawals), applies the new-money cap, and decides the single next action.
 */
export function planTick(i: PlanInput): Plan {
  const { cfg, state, wallets: w, price, desiredBtc, dist } = i;
  const notes: string[] = [];
  const deposits: DepositFound[] = [];
  let heldBack = state.heldBackXaut;

  // 1. Wallet changes since the end of the previous tick = money the bot did not move.
  const snap = state.snapshot;
  if (snap) {
    const dX = w.xaut - snap.xaut;
    const dB = w.btc - snap.btc;
    const equityBefore = snap.xaut + snap.btc / price;
    if (Math.abs(dX) * i.usdPerXaut >= cfg.minTradeUsd) {
      if (dX > 0) {
        const lumpPct = equityBefore > 1e-9 ? (dX / equityBefore) * 100 : 100;
        let action: string;
        if (!desiredBtc) {
          action = "kept as XAUT (strategy is in XAUT)";
        } else if (cfg.newMoneyCap.enabled && lumpPct >= cfg.newMoneyCap.minLumpPct && dist !== null && dist * 100 > cfg.newMoneyCap.maxDistPct) {
          heldBack += dX;
          action = `held back: BTC ${(dist * 100).toFixed(1)}% above baseline (> ${cfg.newMoneyCap.maxDistPct}% new-money cap)`;
        } else {
          action = "will be converted to BTC (strategy is in BTC)";
        }
        deposits.push({ asset: "XAUT", amount: dX, valueXaut: dX, action });
      } else {
        deposits.push({ asset: "XAUT", amount: dX, valueXaut: dX, action: "withdrawal" });
      }
    }
    if (Math.abs(dB) * i.usdPerBtc >= cfg.minTradeUsd) {
      deposits.push({
        asset: "BTC",
        amount: dB,
        valueXaut: dB / price,
        action: dB < 0 ? "withdrawal" : desiredBtc ? "kept as BTC (strategy is in BTC)" : "will be converted to XAUT (strategy is in XAUT)",
      });
    }
  }

  // 2. Release held-back new money.
  if (heldBack > 0) {
    if (!cfg.newMoneyCap.enabled) {
      notes.push("new-money cap switched off: released held-back XAUT");
      heldBack = 0;
    } else if (!desiredBtc) {
      notes.push("strategy is in XAUT: held-back XAUT released");
      heldBack = 0;
    } else if (dist !== null && dist * 100 <= cfg.newMoneyCap.maxDistPct) {
      notes.push(`BTC back within ${cfg.newMoneyCap.maxDistPct}% of baseline: held-back XAUT released`);
      heldBack = 0;
    }
  }
  heldBack = Math.max(0, Math.min(heldBack, w.xaut));

  // 3. Decide the next action.
  let action: PlannedAction;
  let clearStranded = false;
  // Reserves. The XAUT reserve is a pot kept out of the strategy; the USDT reserve is carved out of that
  // pot only. USDT beyond the target is idle and is swept into what the strategy wants (bot-only account).
  const xres = Math.max(0, cfg.xautReserve);
  const usdtTarget = usdtTargetOf(cfg, i.usdPerXaut);
  const parked = Math.min(w.ustAvail, usdtTarget);
  const xautFree = Math.max(0, w.xautAvail - heldBack);
  const xautHold = Math.max(0, xres - parked / i.usdPerXaut); // XAUT that stays in the wallet for the pot
  // Reserve moves must clear the XAUT minimum order (~0.002 XAUT); a plain idle-USDT sweep only needs ~$2
  // (and is parked for a balance whose last sweep could not buy anything).
  const reserveMin = Math.max(cfg.minTradeUsd, 5, 0.0025 * i.usdPerXaut);
  const idleMin = Math.max(cfg.minTradeUsd, 2);
  const idleParked = state.ignoredOthers.includes(`USDT:${w.ustAvail.toFixed(2)}`);
  const excessUst = idleParked ? 0 : Math.max(0, w.ustAvail * 0.999 - usdtTarget);
  if (state.strandedUst >= cfg.minTradeUsd) {
    const ust = Math.min(state.strandedUst, excessUst);
    if (ust >= 1) {
      action = { kind: "sweep", into: desiredBtc ? "btc" : "xaut", ust };
      return { deposits, heldBackXaut: heldBack, clearStranded, action, notes };
    }
    clearStranded = true;
    notes.push("stranded USDT is no longer in the wallet: cleared");
  } else if (state.strandedUst > 0) {
    clearStranded = true; // dust
  }
  // 3-. Any other balance (USD, other coins) is turned into USDT; the idle-USDT sweep then moves it on.
  for (const o of i.others ?? []) {
    if (o.usd >= Math.max(cfg.minTradeUsd, 2)) {
      notes.push(`${o.available} ${o.currency} (~$${o.usd.toFixed(2)}) is neither USDT, BTC nor XAUT: converting to USDT`);
      action = { kind: "convert_other", currency: o.currency, amount: o.available, usd: o.usd };
      return { deposits, heldBackXaut: heldBack, clearStranded, action, notes };
    }
  }
  // 3a. XAUT pot short (XAUT in the wallet plus the USDT carved from it): build it from BTC.
  if (xres > 0 && desiredBtc) {
    const deficit = xres - (xautFree + parked / i.usdPerXaut);
    if (deficit * i.usdPerXaut >= reserveMin) {
      // Idle USDT in the wallet goes into the pot first; BTC is only sold for what is still missing.
      if (excessUst >= reserveMin) {
        const ust = Math.min(excessUst, deficit * i.usdPerXaut);
        notes.push(`XAUT reserve is short: ${ust.toFixed(2)} idle USDT spent on XAUT first`);
        action = { kind: "sweep", into: "xaut", ust, idle: true };
        return { deposits, heldBackXaut: heldBack, clearStranded, action, notes };
      }
      const sell = Math.min(w.btcAvail, deficit * price);
      if (sell * i.usdPerBtc >= cfg.minTradeUsd) {
        notes.push(`XAUT reserve is ${xres} but only ${(xres - deficit).toFixed(4)} is in place: buying XAUT with BTC`);
        action = { kind: "reserve_xaut", btc: sell };
        return { deposits, heldBackXaut: heldBack, clearStranded, action, notes };
      }
    }
  }
  // 3b. USDT reserve short: sell XAUT from the pot (never the strategy position).
  const shortfall = usdtTarget - w.ustAvail;
  if (usdtTarget > 0 && shortfall >= reserveMin) {
    const value = xautFree * i.usdPerXaut;
    if (value >= cfg.minTradeUsd) {
      notes.push(`USDT reserve is ${usdtTarget.toFixed(2)} but the wallet holds ${w.ustAvail.toFixed(2)}: selling XAUT from the reserve`);
      action = { kind: "raise_usdt", usd: Math.min(shortfall, value), base: xautFree };
      return { deposits, heldBackXaut: heldBack, clearStranded, action, notes };
    }
  }
  // 3c. USDT above the reserve target is idle: swept into the desired asset (position cap respected).
  if (excessUst >= idleMin) {
    let ust = excessUst;
    if (desiredBtc && cfg.positionCapXaut > 0) {
      const room = Math.max(0, cfg.positionCapXaut - w.btc / price);
      ust = Math.min(ust, room * i.usdPerXaut);
    }
    if (ust >= idleMin) {
      action = { kind: "sweep", into: desiredBtc ? "btc" : "xaut", ust, idle: true };
      notes.push(`${ust.toFixed(2)} USDT sitting idle in the wallet: swept into ${desiredBtc ? "BTC" : "XAUT"}`);
      return { deposits, heldBackXaut: heldBack, clearStranded, action, notes };
    }
  }

  if (desiredBtc) {
    let sell = Math.max(0, w.xautAvail - heldBack - xautHold);
    let why = "";
    if (cfg.positionCapXaut > 0) {
      const room = Math.max(0, cfg.positionCapXaut - w.btc / price);
      if (room < sell) {
        sell = room;
        why = ` (position cap ${cfg.positionCapXaut} XAUT)`;
      }
    }
    if (sell * i.usdPerXaut >= cfg.minTradeUsd) action = { kind: "to_btc", xaut: sell };
    else action = { kind: "none", why: heldBack > 0 ? `holding BTC; ${heldBack.toFixed(4)} XAUT held back by the new-money cap` : `holding BTC${why}; nothing to convert` };
  } else {
    if (w.btcAvail * i.usdPerBtc >= cfg.minTradeUsd) action = { kind: "to_xaut", btc: w.btcAvail };
    else action = { kind: "none", why: "holding XAUT; nothing to convert" };
  }
  return { deposits, heldBackXaut: heldBack, clearStranded, action, notes };
}

// ---------------------------------------------------------------- tick

export interface TickResult {
  action: "disabled" | "idle" | "would_to_btc" | "would_to_xaut" | "would_sweep" | "would_raise_usdt" | "would_reserve" | "would_convert" | "rotated" | "raised" | "reserved" | "converted" | "swept" | "blocked" | "error";
  detail: string;
}

const fx = (n: number, d = 6) => n.toFixed(d);

/**
 * One pass: read the market and wallets, plan, and (only when enabled AND LIVE)
 * execute. DRY_RUN reads everything and logs what it would do, never an order.
 */
export async function runTick(d: { ex: Exchange; store: Store; now?: number; pollMs?: number }): Promise<TickResult> {
  const { ex, store } = d;
  const now = d.now ?? Date.now();
  const cfg = store.getConfig();
  let state = store.getState();
  const finish = (r: TickResult): TickResult => {
    state = { ...state, lastResult: { action: r.action, detail: r.detail, at: now }, lastTickAt: now };
    store.setState(state);
    return r;
  };

  try {
    const [candles, xautBtc, xautUst, btcUst, walletRows] = await Promise.all([
      ex.getDailyCandles(XAUT_BTC, CANDLE_LIMIT),
      ex.getTicker(XAUT_BTC),
      ex.getTicker(XAUT_UST),
      ex.getTicker(BTC_UST),
      ex.getWallets(),
    ]);
    const newest = candles[candles.length - 1];
    if (!newest || now / 1000 - newest.time > 3 * 86_400) {
      return finish({ action: "blocked", detail: "candle data is stale or empty (newest bar is more than 3 days old); not trading" });
    }
    const a = analyze(candles, cfg, now);
    if (!a.last) return finish({ action: "blocked", detail: `not enough daily candles yet (${a.bars.length}); the lines need at least 29` });
    const price = xautBtc.last;
    if (!(price > 0) || !(xautUst.last > 0) || !(btcUst.last > 0)) return finish({ action: "blocked", detail: "missing prices" });
    const wallets = walletView(walletRows);

    // USD value of every balance that is not USDT, BTC or XAUT (skipping ones that failed before and have not changed).
    const others: Array<{ currency: string; available: number; usd: number }> = [];
    for (const o of wallets.others ?? []) {
      if (state.ignoredOthers.includes(`${o.currency}:${o.available.toFixed(4)}`)) continue;
      let usd = 0;
      if (o.currency === "USD") usd = o.available;
      else {
        try {
          usd = o.available * (await ex.getTicker(otherSymbol(o.currency))).bid;
        } catch {
          usd = 0;
        }
      }
      others.push({ currency: o.currency, available: o.available, usd });
    }

    const plan = planTick({
      cfg,
      state,
      wallets,
      price,
      usdPerXaut: xautUst.last,
      usdPerBtc: btcUst.last,
      desiredBtc: a.desiredBtc,
      dist: a.last.dist,
      others,
    });

    for (const dep of plan.deposits) {
      store.addDeposit({ ts: now, asset: dep.asset, amount: dep.amount, valueXaut: dep.valueXaut, dist: a.last.dist, action: dep.action });
      store.addEvent("deposit", `${dep.amount > 0 ? "Deposit" : "Withdrawal"} seen: ${fx(Math.abs(dep.amount), 6)} ${dep.asset} - ${dep.action}`, undefined, now);
    }
    for (const n of plan.notes) store.addEvent("info", n, undefined, now);
    state = { ...state, heldBackXaut: plan.heldBackXaut, ...(plan.clearStranded ? { strandedUst: 0 } : {}) };

    const equityXaut = wallets.xaut + wallets.btc / price + parkedUst(wallets, cfg, state.strandedUst, xautUst.last) / xautUst.last;
    store.addSnapshot({ ts: now, xaut: wallets.xaut, btc: wallets.btc, price, equityXaut });
    const baseline = { xaut: wallets.xaut, btc: wallets.btc, at: now };

    const want = a.desiredBtc ? "BTC" : "XAUT";
    if (!cfg.enabled) {
      state = { ...state, snapshot: baseline };
      return finish({ action: "disabled", detail: `bot is disabled (strategy wants ${want}, regime ${a.last.regime})` });
    }
    if (plan.action.kind === "none") {
      state = { ...state, snapshot: baseline };
      return finish({ action: "idle", detail: `${plan.action.why} (strategy wants ${want}, regime ${a.last.regime})` });
    }

    const act = plan.action;
    const describe =
      act.kind === "to_btc"
        ? `${fx(act.xaut, 6)} XAUT -> BTC`
        : act.kind === "to_xaut"
          ? `${fx(act.btc, 8)} BTC -> XAUT`
          : act.kind === "raise_usdt"
            ? `${fx(act.usd, 2)} USDT from XAUT (USDT reserve)`
            : act.kind === "reserve_xaut"
              ? `${fx(act.btc, 8)} BTC -> XAUT (XAUT reserve)`
              : act.kind === "convert_other"
                ? `${fx(act.amount, 6)} ${act.currency} (~$${fx(act.usd, 2)}) -> USDT`
                : `${fx(act.ust, 2)} USDT -> ${act.into.toUpperCase()}`;

    if (cfg.mode !== "LIVE" || ex.runMode !== "LIVE") {
      state = { ...state, snapshot: baseline };
      const key = `${act.kind}:${describe}`;
      if (state.lastWouldKey !== key) {
        store.addEvent("would", `[DRY_RUN] would convert ${describe}`, { regime: a.last.regime, dist: a.last.dist }, now);
        state = { ...state, lastWouldKey: key };
      }
      const kind = act.kind === "to_btc" ? "would_to_btc" : act.kind === "to_xaut" ? "would_to_xaut" : act.kind === "raise_usdt" ? "would_raise_usdt" : act.kind === "reserve_xaut" ? "would_reserve" : act.kind === "convert_other" ? "would_convert" : "would_sweep";
      return finish({ action: kind, detail: `[DRY_RUN] would convert ${describe}` });
    }

    // ---- LIVE ----
    // Reserve moves and idle-USDT sweeps are tagged "usdt:" so they never pose as trade entries/exits.
    const rotationId = act.kind === "raise_usdt" || act.kind === "convert_other" || (act.kind === "sweep" && act.idle) ? `usdt:${now}` : act.kind === "reserve_xaut" ? `xres:${now}` : String(now);
    const onFill = (f: { symbol: string; side: "buy" | "sell"; base: number; price: number }) =>
      store.addFill({ ts: Date.now(), rotationId, symbol: f.symbol, side: f.side, base: f.base, price: f.price });
    store.addEvent("rotation_start", `Converting ${describe}`, { regime: a.last.regime, dist: a.last.dist }, now);

    let stranded: number;
    let summary: string;
    let interrupted: string | null;
    let kind: TickResult["action"];
    if (act.kind === "raise_usdt") {
      const r = await raiseUst({ ex, from: "xaut", usd: act.usd, maxBase: act.base, chunkUsd: cfg.chunkUsd, onFill, ...(d.pollMs !== undefined ? { pollMs: d.pollMs } : {}) });
      stranded = state.strandedUst;
      summary = `Raised ${fx(r.proceeds, 2)} USDT by selling ${fx(r.sold, 6)} XAUT from the reserve`;
      interrupted = r.interrupted;
      kind = "raised";
    } else if (act.kind === "convert_other") {
      const r = await convertToUst({ ex, currency: act.currency, amount: act.amount, chunkUsd: cfg.chunkUsd, onFill, ...(d.pollMs !== undefined ? { pollMs: d.pollMs } : {}) });
      stranded = state.strandedUst;
      summary = `Converted ${fx(r.spent, 6)} ${act.currency} into ${fx(r.gotUst, 2)} USDT`;
      interrupted = r.interrupted;
      kind = "converted";
      if (r.gotUst <= 0) {
        // Nothing could be converted (below the minimum order, no pair...): leave it alone until the balance changes.
        state = { ...state, ignoredOthers: [...state.ignoredOthers, `${act.currency}:${act.amount.toFixed(4)}`].slice(-20) };
      }
    } else if (act.kind === "sweep") {
      const r = await sweepUst({ ex, into: act.into, ust: act.ust, chunkUsd: cfg.chunkUsd, onFill, ...(d.pollMs !== undefined ? { pollMs: d.pollMs } : {}) });
      stranded = r.strandedUst;
      summary = `Swept ${fx(r.spentUst, 2)} USDT into ${act.into.toUpperCase()} (${fx(r.bought, act.into === "btc" ? 8 : 6)} bought)`;
      interrupted = r.interrupted;
      kind = "swept";
      if (act.idle && r.bought <= 0) {
        // Too small for the pair's minimum order: leave it alone until the USDT balance changes.
        state = { ...state, ignoredOthers: [...state.ignoredOthers, `USDT:${wallets.ustAvail.toFixed(2)}`].slice(-20) };
      }
    } else {
      const r = await rotate({
        ex,
        direction: act.kind === "to_btc" ? "xaut_to_btc" : "btc_to_xaut",
        amount: act.kind === "to_btc" ? act.xaut : act.btc,
        chunkUsd: cfg.chunkUsd,
        onFill,
        ...(d.pollMs !== undefined ? { pollMs: d.pollMs } : {}),
      });
      stranded = r.strandedUst;
      const [soldU, boughtU, soldD, boughtD] = act.kind === "to_btc" ? ["XAUT", "BTC", 6, 8] : ["BTC", "XAUT", 8, 6];
      summary = `Sold ${fx(r.sold, soldD as number)} ${soldU}, bought ${fx(r.bought, boughtD as number)} ${boughtU}`;
      interrupted = r.interrupted;
      kind = act.kind === "reserve_xaut" ? "reserved" : "rotated";
    }
    state = { ...state, strandedUst: act.kind === "sweep" && act.idle ? state.strandedUst : stranded, lastWouldKey: null };
    store.addEvent(interrupted ? "rotation_partial" : "rotation_done", interrupted ? `${summary} - stopped: ${interrupted}` : summary, { stranded }, Date.now());

    // New baseline = wallets after our own trades, so they are never mistaken for deposits.
    try {
      const after = walletView(await ex.getWallets());
      state = { ...state, snapshot: { xaut: after.xaut, btc: after.btc, at: Date.now() } };
    } catch {
      state = { ...state, snapshot: null };
    }
    return finish({ action: kind, detail: interrupted ? `${summary} - stopped: ${interrupted}` : summary });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.addEvent("error", msg, undefined, now);
    return finish({ action: "error", detail: msg });
  }
}
