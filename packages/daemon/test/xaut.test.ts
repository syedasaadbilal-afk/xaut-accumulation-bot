import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_STATE, parseConfig, type BotConfig, type BotState } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";
import { applyMigrations } from "../src/db/migrate.js";
import { analyze, planTick, runTick, type PlanInput } from "../src/engine.js";
import { rotate } from "../src/execute.js";
import { computeLarsson, invertCandles, replaySignals } from "../src/larsson.js";
import { twrXautPct } from "../src/service.js";
import { Store } from "../src/store.js";
import { attachActual, buildExecutions } from "../src/timeline.js";
import { DOWN_CLOSES, FakeExchange, UP_CLOSES, nowAfter, xautBtcPath } from "./helpers.js";

const cfg = (over: Partial<BotConfig> = {}): BotConfig => ({ ...DEFAULT_CONFIG, enabled: true, mode: "LIVE", dailyDeployCap: { enabled: false, maxUsd: 2000 }, ...over });
const newStore = () => {
  const db = openDatabase(":memory:");
  applyMigrations(db);
  return new Store(db);
};

describe("mirror larsson engine", () => {
  it("inverts XAUT/BTC candles into BTC-in-XAUT with swapped high/low", () => {
    const inv = invertCandles([{ time: 1, open: 0.04, high: 0.05, low: 0.02, close: 0.025 }]);
    expect(inv[0]).toEqual({ time: 1, open: 25, high: 50, low: 20, close: 40 });
  });

  it("wants BTC while BTC rallies against XAUT and goes back to XAUT when it crashes", () => {
    const up = analyze(xautBtcPath(UP_CLOSES), cfg(), nowAfter(UP_CLOSES.length));
    expect(up.last?.regime).toBe("orange");
    expect(up.desiredBtc).toBe(true);
    expect(up.signals.map((s) => s.action)).toEqual(["enter"]);

    const down = analyze(xautBtcPath(DOWN_CLOSES), cfg(), nowAfter(DOWN_CLOSES.length));
    expect(down.desiredBtc).toBe(false);
    expect(down.signals.map((s) => s.action)).toEqual(["enter", "exit"]);
  });

  it("measures each trade in XAUT (exit/entry on the inverted price)", () => {
    const a = analyze(xautBtcPath(DOWN_CLOSES), cfg(), nowAfter(DOWN_CLOSES.length));
    const bars = a.bars;
    const enter = a.signals[0]!;
    const exit = a.signals[1]!;
    const ei = bars.findIndex((b) => b.time === enter.signalBarTime);
    const xi = bars.findIndex((b) => b.time === exit.signalBarTime);
    expect(enter.signalPrice).toBeCloseTo(bars[ei + 1]!.open, 12);
    expect(exit.signalPrice).toBeCloseTo(bars[xi + 1]!.open, 12);
  });

  it("does not signal on the still-forming bar", () => {
    const bars = computeLarsson(invertCandles(xautBtcPath(UP_CLOSES)), nowAfter(UP_CLOSES.length - 1));
    expect(bars[bars.length - 1]!.confirmed).toBe(false);
    expect(bars[bars.length - 2]!.confirmed).toBe(true);
  });

  it("strategy entry cap blocks a flat->BTC entry while too extended, and never cuts an exit", () => {
    const a0 = analyze(xautBtcPath(UP_CLOSES), cfg(), nowAfter(UP_CLOSES.length));
    expect(a0.last!.dist).toBeGreaterThan(0.001);
    // Absurdly tight cap: never allowed to enter during this steady rally.
    const tight = analyze(xautBtcPath(UP_CLOSES), cfg({ strategyCap: { enabled: true, maxDistPct: 0.0001 } }), nowAfter(UP_CLOSES.length));
    expect(tight.desiredBtc).toBe(false);
    expect(tight.desiredBtcUncapped).toBe(true);
    expect(tight.signals).toHaveLength(0);
    // Generous cap behaves like no cap.
    const loose = analyze(xautBtcPath(UP_CLOSES), cfg({ strategyCap: { enabled: true, maxDistPct: 99 } }), nowAfter(UP_CLOSES.length));
    expect(loose.desiredBtc).toBe(true);
    // A cap that is off is ignored even with a tight number.
    const off = analyze(xautBtcPath(UP_CLOSES), cfg({ strategyCap: { enabled: false, maxDistPct: 0.0001 } }), nowAfter(UP_CLOSES.length));
    expect(off.desiredBtc).toBe(true);
  });

  it("entry re-checks the cap each orange bar (can enter later)", () => {
    const bars = computeLarsson(invertCandles(xautBtcPath(UP_CLOSES)), nowAfter(UP_CLOSES.length));
    const dists = bars.filter((b) => b.regime === "orange" && b.dist !== null).map((b) => b.dist! * 100);
    const cap = (Math.min(...dists) + Math.max(...dists)) / 2;
    const { signals } = replaySignals(bars, cap);
    if (signals.length) {
      const entryBar = bars.find((b) => b.time === signals[0]!.signalBarTime)!;
      expect(entryBar.dist! * 100).toBeLessThanOrEqual(cap);
    }
  });
});

const baseInput = (over: Partial<PlanInput> = {}, state: Partial<BotState> = {}): PlanInput => ({
  cfg: cfg(),
  state: { ...DEFAULT_STATE, ...state },
  wallets: { xaut: 10, btc: 0, xautAvail: 10, btcAvail: 0, ustAvail: 0 },
  price: 0.04,
  usdPerXaut: 4000,
  usdPerBtc: 100_000,
  desiredBtc: true,
  dist: 0.02,
  ...over,
});

describe("planTick", () => {
  it("converts all XAUT to BTC when the strategy wants BTC, and all BTC to XAUT when it wants XAUT", () => {
    expect(planTick(baseInput()).action).toEqual({ kind: "to_btc", xaut: 10 });
    const p = planTick(baseInput({ desiredBtc: false, wallets: { xaut: 0, btc: 0.5, xautAvail: 0, btcAvail: 0.5, ustAvail: 0 } }));
    expect(p.action).toEqual({ kind: "to_xaut", btc: 0.5 });
  });

  it("ignores dust below minTradeUsd", () => {
    const p = planTick(baseInput({ wallets: { xaut: 0.001, btc: 0, xautAvail: 0.001, btcAvail: 0, ustAvail: 0 } }));
    expect(p.action.kind).toBe("none");
  });

  it("detects a wallet rise the bot did not cause as a deposit", () => {
    const p = planTick(
      baseInput({ wallets: { xaut: 12, btc: 0.4, xautAvail: 12, btcAvail: 0.4, ustAvail: 0 } }, { snapshot: { xaut: 10, btc: 0.4, at: 1 } })
    );
    expect(p.deposits).toHaveLength(1);
    expect(p.deposits[0]).toMatchObject({ asset: "XAUT", amount: 2 });
    expect(p.heldBackXaut).toBe(0); // cap is off by default: deployed normally
  });

  it("no snapshot means no deposits (first tick just sets the baseline)", () => {
    expect(planTick(baseInput()).deposits).toHaveLength(0);
  });

  it("new-money cap holds back a deposit made while BTC is extended, and does not touch the old position", () => {
    const c = cfg({ newMoneyCap: { enabled: true, maxDistPct: 5, minLumpPct: 0 } });
    const w = { xaut: 3, btc: 1, xautAvail: 3, btcAvail: 1, ustAvail: 0 };
    const p = planTick(baseInput({ cfg: c, dist: 0.08, wallets: w }, { snapshot: { xaut: 0, btc: 1, at: 1 } }));
    expect(p.deposits[0]!.action).toMatch(/held back/);
    expect(p.heldBackXaut).toBe(3);
    expect(p.action.kind).toBe("none");
  });

  it("new-money cap deploys a deposit made while BTC is within the cap", () => {
    const c = cfg({ newMoneyCap: { enabled: true, maxDistPct: 5, minLumpPct: 0 } });
    const w = { xaut: 3, btc: 1, xautAvail: 3, btcAvail: 1, ustAvail: 0 };
    const p = planTick(baseInput({ cfg: c, dist: 0.03, wallets: w }, { snapshot: { xaut: 0, btc: 1, at: 1 } }));
    expect(p.heldBackXaut).toBe(0);
    expect(p.action).toEqual({ kind: "to_btc", xaut: 3 });
  });

  it("minLumpPct: small top-ups are deployed even when extended, big lumps are held", () => {
    const c = cfg({ newMoneyCap: { enabled: true, maxDistPct: 5, minLumpPct: 20 } });
    // equity before = 0 XAUT + 1 BTC / 0.04 = 25 XAUT. 1 XAUT deposit = 4% -> deploy. 10 XAUT = 40% -> hold.
    const small = planTick(baseInput({ cfg: c, dist: 0.08, wallets: { xaut: 1, btc: 1, xautAvail: 1, btcAvail: 1, ustAvail: 0 } }, { snapshot: { xaut: 0, btc: 1, at: 1 } }));
    expect(small.heldBackXaut).toBe(0);
    expect(small.action.kind).toBe("to_btc");
    const big = planTick(baseInput({ cfg: c, dist: 0.08, wallets: { xaut: 10, btc: 1, xautAvail: 10, btcAvail: 1, ustAvail: 0 } }, { snapshot: { xaut: 0, btc: 1, at: 1 } }));
    expect(big.heldBackXaut).toBe(10);
  });

  it("releases held-back money when price returns within the cap, when the strategy exits, or when the cap is switched off", () => {
    const c = cfg({ newMoneyCap: { enabled: true, maxDistPct: 5, minLumpPct: 0 } });
    const w = { xaut: 3, btc: 1, xautAvail: 3, btcAvail: 1, ustAvail: 0 };
    const held = { heldBackXaut: 3, snapshot: { xaut: 3, btc: 1, at: 1 } };
    expect(planTick(baseInput({ cfg: c, dist: 0.07, wallets: w }, held)).heldBackXaut).toBe(3); // still extended
    const back = planTick(baseInput({ cfg: c, dist: 0.04, wallets: w }, held));
    expect(back.heldBackXaut).toBe(0);
    expect(back.action).toEqual({ kind: "to_btc", xaut: 3 });
    expect(planTick(baseInput({ cfg: c, dist: 0.07, desiredBtc: false, wallets: w }, held)).heldBackXaut).toBe(0);
    expect(planTick(baseInput({ cfg: cfg(), dist: 0.07, wallets: w }, held)).heldBackXaut).toBe(0);
  });

  it("a BTC deposit while the strategy wants XAUT is converted to XAUT", () => {
    const p = planTick(
      baseInput(
        { desiredBtc: false, wallets: { xaut: 5, btc: 0.2, xautAvail: 5, btcAvail: 0.2, ustAvail: 0 } },
        { snapshot: { xaut: 5, btc: 0, at: 1 } }
      )
    );
    expect(p.deposits[0]).toMatchObject({ asset: "BTC" });
    expect(p.action).toEqual({ kind: "to_xaut", btc: 0.2 });
  });

  it("position cap limits how much XAUT-equivalent may sit in BTC", () => {
    const c = cfg({ positionCapXaut: 8 });
    // already 0.1 BTC = 2.5 XAUT in BTC, 10 XAUT available: room = 5.5
    const p = planTick(baseInput({ cfg: c, wallets: { xaut: 10, btc: 0.1, xautAvail: 10, btcAvail: 0.1, ustAvail: 0 } }));
    expect(p.action.kind).toBe("to_btc");
    expect((p.action as { xaut: number }).xaut).toBeCloseTo(5.5, 9);
  });

  it("sweeps stranded USDT into the asset the strategy wants before anything else", () => {
    const p = planTick(baseInput({ wallets: { xaut: 10, btc: 0, xautAvail: 10, btcAvail: 0, ustAvail: 500 } }, { strandedUst: 400 }));
    expect(p.action).toEqual({ kind: "sweep", into: "btc", ust: 400 });
    const q = planTick(baseInput({ desiredBtc: false, wallets: { xaut: 0, btc: 0, xautAvail: 0, btcAvail: 0, ustAvail: 500 } }, { strandedUst: 400 }));
    expect(q.action).toEqual({ kind: "sweep", into: "xaut", ust: 400 });
  });

  it("clears stranded USDT that is no longer in the wallet", () => {
    const p = planTick(baseInput({ wallets: { xaut: 10, btc: 0, xautAvail: 10, btcAvail: 0, ustAvail: 0 } }, { strandedUst: 400 }));
    expect(p.clearStranded).toBe(true);
    expect(p.action.kind).toBe("to_btc");
  });
});

describe("daily deployment cap", () => {
  const w = { xaut: 10, btc: 0, xautAvail: 10, btcAvail: 0, ustAvail: 0 }; // 10 XAUT = $40,000 at $4,000
  const on = cfg({ dailyDeployCap: { enabled: true, maxUsd: 2000 } });

  it("defaults to on at $2,000", () => {
    expect(DEFAULT_CONFIG.dailyDeployCap).toEqual({ enabled: true, maxUsd: 2000 });
  });

  it("limits a big conversion into BTC to the room left in the rolling 24h", () => {
    const p = planTick(baseInput({ cfg: on, wallets: w, deployedUsd24h: 0 }));
    expect(p.action.kind).toBe("to_btc");
    expect((p.action as { xaut: number }).xaut).toBeCloseTo(0.5, 9); // $2,000 / $4,000
    const q = planTick(baseInput({ cfg: on, wallets: w, deployedUsd24h: 1200 }));
    expect((q.action as { xaut: number }).xaut).toBeCloseTo(0.2, 9);
  });

  it("waits when the cap is used up, and never caps the exit back to XAUT", () => {
    const p = planTick(baseInput({ cfg: on, wallets: w, deployedUsd24h: 2000 }));
    expect(p.action.kind).toBe("none");
    expect((p.action as { why: string }).why).toMatch(/daily deployment cap/);
    const exit = planTick(baseInput({ cfg: on, desiredBtc: false, wallets: { xaut: 0, btc: 5, xautAvail: 0, btcAvail: 5, ustAvail: 0 }, deployedUsd24h: 99999 }));
    expect(exit.action).toEqual({ kind: "to_xaut", btc: 5 });
  });

  it("is ignored when switched off", () => {
    expect(planTick(baseInput({ cfg: cfg(), wallets: w, deployedUsd24h: 99999 })).action).toEqual({ kind: "to_btc", xaut: 10 });
  });

  it("runTick drip-feeds: first tick moves ~$2,000, the next tick (cap used) moves nothing", async () => {
    const store = newStore();
    store.setConfig({ ...on, chunkUsd: 500 });
    const ex = new FakeExchange({ closes: UP_CLOSES, xaut: 10 });
    const NOW = nowAfter(UP_CLOSES.length);
    const r1 = await runTick({ ex, store, now: NOW, pollMs: 0 });
    expect(r1.action).toBe("rotated");
    expect(ex.wallets["XAUT"]).toBeGreaterThan(9.4);
    expect(ex.wallets["XAUT"]).toBeLessThan(9.6);
    expect(store.deployedUsdSince(0)).toBeGreaterThan(1900);
    const r2 = await runTick({ ex, store, now: NOW + 60_000, pollMs: 0 });
    expect(r2.action).toBe("idle");
    expect(r2.detail).toMatch(/daily deployment cap/);
  });

  it("validates the setting", () => {
    expect("error" in parseConfig({ ...DEFAULT_CONFIG, dailyDeployCap: { enabled: true, maxUsd: 0 } })).toBe(true);
    expect("config" in parseConfig({ ...DEFAULT_CONFIG, dailyDeployCap: { enabled: false, maxUsd: 5000 } })).toBe(true);
  });
});

describe("rotate (executor)", () => {
  it("sells XAUT for USDT then buys BTC with the proceeds, chunk by chunk, one order at a time", async () => {
    const ex = new FakeExchange({ closes: UP_CLOSES, xaut: 2 });
    const r = await rotate({ ex, direction: "xaut_to_btc", amount: 2, chunkUsd: 3000, pollMs: 0, log: () => {} });
    expect(r.interrupted).toBeNull();
    expect(r.sold).toBeCloseTo(2, 6);
    expect(ex.wallets["XAUT"]).toBeCloseTo(0, 6);
    expect(ex.wallets["BTC"]).toBeGreaterThan(0.07); // ~ 2*4000/100000 = 0.08 minus the fee allowance
    expect(ex.orders.filter((o) => o.symbol === "tXAUT:UST").length).toBe(3); // 3000 USD chunks over 8000 USD
    expect(r.strandedUst).toBe(0);
    // every sell is paired with a buy
    expect(ex.orders.map((o) => (o.amount < 0 ? "S" : "B")).join("")).toMatch(/^(SB)+$/);
  });

  it("reports stranded USDT when the buy leg cannot complete", async () => {
    const ex = new FakeExchange({ closes: UP_CLOSES, btc: 0.1 });
    const real = ex.getMinOrderSize.bind(ex);
    ex.getMinOrderSize = async (s: string) => (s === "tXAUT:UST" ? 1000 : real());
    const r = await rotate({ ex, direction: "btc_to_xaut", amount: 0.1, chunkUsd: 10_000, pollMs: 0, log: () => {} });
    expect(r.sold).toBeCloseTo(0.1, 6);
    expect(r.bought).toBe(0);
    expect(r.strandedUst).toBeGreaterThan(9000);
    expect(r.interrupted).toMatch(/USDT left/);
  });
});

describe("runTick", () => {
  const NOW = nowAfter(UP_CLOSES.length);

  it("disabled: records state and deposits but trades nothing", async () => {
    const store = newStore();
    store.setConfig({ ...DEFAULT_CONFIG });
    const ex = new FakeExchange({ closes: UP_CLOSES, xaut: 10 });
    const r = await runTick({ ex, store, now: NOW, pollMs: 0 });
    expect(r.action).toBe("disabled");
    expect(ex.orders).toHaveLength(0);
    expect(store.getState().snapshot?.xaut).toBe(10);
  });

  it("DRY_RUN: logs what it would do once, never submits an order", async () => {
    const store = newStore();
    store.setConfig(cfg({ mode: "DRY_RUN" }));
    const ex = new FakeExchange({ closes: UP_CLOSES, xaut: 10, mode: "DRY_RUN" });
    const r1 = await runTick({ ex, store, now: NOW, pollMs: 0 });
    expect(r1.action).toBe("would_to_btc");
    await runTick({ ex, store, now: NOW + 60_000, pollMs: 0 });
    expect(ex.orders).toHaveLength(0);
    expect(store.events().filter((e) => e.kind === "would")).toHaveLength(1); // deduped
  });

  it("LIVE in config but DRY_RUN exchange still never trades (second safety)", async () => {
    const store = newStore();
    store.setConfig(cfg({ mode: "LIVE" }));
    const ex = new FakeExchange({ closes: UP_CLOSES, xaut: 10, mode: "DRY_RUN" });
    const r = await runTick({ ex, store, now: NOW, pollMs: 0 });
    expect(r.action).toBe("would_to_btc");
    expect(ex.orders).toHaveLength(0);
  });

  it("LIVE: rotates XAUT to BTC, logs fills, and does not read its own trades as a deposit next tick", async () => {
    const store = newStore();
    store.setConfig(cfg({ chunkUsd: 5000 }));
    const ex = new FakeExchange({ closes: UP_CLOSES, xaut: 4 });
    const r = await runTick({ ex, store, now: NOW, pollMs: 0 });
    expect(r.action).toBe("rotated");
    expect(ex.wallets["XAUT"]).toBeCloseTo(0, 6);
    expect(ex.wallets["BTC"]).toBeGreaterThan(0.15);
    expect(store.fills().length).toBeGreaterThan(1);
    const r2 = await runTick({ ex, store, now: NOW + 60_000, pollMs: 0 });
    expect(r2.action).toBe("idle");
    expect(store.deposits()).toHaveLength(0);
  });

  it("LIVE: new XAUT deposited later is detected, logged, and converted (cap off)", async () => {
    const store = newStore();
    store.setConfig(cfg({ chunkUsd: 5000 }));
    const ex = new FakeExchange({ closes: UP_CLOSES, xaut: 4 });
    await runTick({ ex, store, now: NOW, pollMs: 0 });
    ex.wallets["XAUT"] = 2; // user deposits 2 XAUT
    const r = await runTick({ ex, store, now: NOW + 60_000, pollMs: 0 });
    expect(store.deposits()).toHaveLength(1);
    expect(store.deposits()[0]).toMatchObject({ asset: "XAUT" });
    expect(store.deposits()[0]!.amount).toBeCloseTo(2, 9);
    expect(r.action).toBe("rotated");
    expect(ex.wallets["XAUT"]).toBeCloseTo(0, 6);
  });

  it("LIVE: new-money cap holds a mid-uptrend deposit in XAUT and the old position stays BTC", async () => {
    const store = newStore();
    store.setConfig(cfg({ chunkUsd: 5000, newMoneyCap: { enabled: true, maxDistPct: 0.0001, minLumpPct: 0 } }));
    const ex = new FakeExchange({ closes: UP_CLOSES, xaut: 4 });
    await runTick({ ex, store, now: NOW, pollMs: 0 }); // first deployment of the original money
    ex.wallets["XAUT"] = 2;
    const r = await runTick({ ex, store, now: NOW + 60_000, pollMs: 0 });
    expect(r.action).toBe("idle");
    expect(ex.wallets["XAUT"]).toBe(2);
    expect(store.getState().heldBackXaut).toBe(2);
    const dep = store.deposits()[0]!;
    expect(dep.action).toMatch(/held back/);
  });

  it("LIVE: exits to XAUT when the strategy flips, and BTC deposits are converted too", async () => {
    const store = newStore();
    store.setConfig(cfg({ chunkUsd: 20_000 }));
    const NOW2 = nowAfter(DOWN_CLOSES.length);
    const ex = new FakeExchange({ closes: DOWN_CLOSES, btc: 0.5 });
    const r = await runTick({ ex, store, now: NOW2, pollMs: 0 });
    expect(r.action).toBe("rotated");
    expect(ex.wallets["BTC"]).toBeCloseTo(0, 6);
    expect(ex.wallets["XAUT"]).toBeGreaterThan(11);
  });

  it("refuses to act on stale candles", async () => {
    const store = newStore();
    store.setConfig(cfg());
    const ex = new FakeExchange({ closes: UP_CLOSES, xaut: 1 });
    const r = await runTick({ ex, store, now: nowAfter(UP_CLOSES.length + 10), pollMs: 0 });
    expect(r.action).toBe("blocked");
    expect(r.detail).toMatch(/stale/);
    expect(ex.orders).toHaveLength(0);
  });

  it("blocked without enough candles", async () => {
    const store = newStore();
    store.setConfig(cfg());
    const ex = new FakeExchange({ closes: UP_CLOSES.slice(0, 20), xaut: 1 });
    expect((await runTick({ ex, store, now: nowAfter(20), pollMs: 0 })).action).toBe("blocked");
  });
});

describe("config and account return", () => {
  it("defaults are safe: disabled, DRY_RUN, both caps off", () => {
    expect(DEFAULT_CONFIG.enabled).toBe(false);
    expect(DEFAULT_CONFIG.mode).toBe("DRY_RUN");
    expect(DEFAULT_CONFIG.strategyCap.enabled).toBe(false);
    expect(DEFAULT_CONFIG.newMoneyCap.enabled).toBe(false);
    expect(DEFAULT_CONFIG.positionCapXaut).toBe(0);
  });

  it("validates config input", () => {
    expect("config" in parseConfig(DEFAULT_CONFIG)).toBe(true);
    expect("error" in parseConfig({ ...DEFAULT_CONFIG, mode: "PAPER" })).toBe(true);
    expect("error" in parseConfig({ ...DEFAULT_CONFIG, chunkUsd: 1 })).toBe(true);
    expect("error" in parseConfig({ ...DEFAULT_CONFIG, strategyCap: { enabled: true, maxDistPct: 0 } })).toBe(true);
    expect("error" in parseConfig({ ...DEFAULT_CONFIG, newMoneyCap: { enabled: true, maxDistPct: 5, minLumpPct: -1 } })).toBe(true);
  });

  it("stored config fills in new fields from defaults", () => {
    const store = newStore();
    expect(store.getConfig()).toEqual(DEFAULT_CONFIG);
    store.setConfig(cfg({ chunkUsd: 250 }));
    expect(store.getConfig().chunkUsd).toBe(250);
  });

  it("account XAUT return ignores deposits (time-weighted)", () => {
    const snaps = [
      { ts: 1, xaut: 10, btc: 0, price: 0.04, equityXaut: 10 },
      { ts: 2, xaut: 10, btc: 0, price: 0.04, equityXaut: 20 }, // +10 XAUT deposited, no performance
      { ts: 3, xaut: 10, btc: 0, price: 0.04, equityXaut: 22 }, // +10% on 20
    ];
    const deps = [{ id: 1, ts: 2, asset: "XAUT", amount: 10, valueXaut: 10, dist: null, action: "x" }];
    expect(twrXautPct(snaps, deps)).toBeCloseTo(10, 9);
    expect(twrXautPct(snaps.slice(0, 1), deps)).toBeNull();
  });
});

describe("timeline: executions and signal vs actual trades", () => {
  const f = (id: number, ts: number, rotationId: string, symbol: string, side: "buy" | "sell", base: number, price: number) => ({ id, ts, rotationId, symbol, side, base, price });
  const DAYMS = 86_400_000;
  const t0 = 1_700_000_000_000;
  // Entry: sell 2 XAUT at $4,000, buy 0.08 BTC at $100,000 -> 25 XAUT per BTC. Exit: sell 0.08 BTC at $100,000, buy 2.2 XAUT at $3,636.36 -> 27.5 XAUT per BTC.
  const fills = [
    f(1, t0 + 1000, "A", "tXAUT:UST", "sell", 2, 4000),
    f(2, t0 + 2000, "A", "tBTCUST", "buy", 0.08, 100000),
    f(3, t0 + 10 * DAYMS + 1000, "B", "tBTCUST", "sell", 0.08, 100000),
    f(4, t0 + 10 * DAYMS + 2000, "B", "tXAUT:UST", "buy", 2.2, 8000 / 2.2),
  ];

  it("groups fills into one execution per rotation with the implied XAUT-per-BTC price", () => {
    const ex = buildExecutions(fills);
    expect(ex.map((e) => e.kind)).toEqual(["to_xaut", "to_btc"]); // newest first
    const entry = ex[1]!;
    expect(entry.sold).toBe(2);
    expect(entry.bought).toBe(0.08);
    expect(entry.ratio).toBeCloseTo(25, 9);
  });

  it("measures a closed trade from the real fills, next to the signal prices", () => {
    const signalTrade = {
      entryTime: Math.floor(t0 / 1000),
      entrySignal: 24,
      exitTime: Math.floor((t0 + 10 * DAYMS) / 1000),
      exitSignal: 27,
      status: "closed" as const,
      xautReturnPct: 12.5,
    };
    const [row] = attachActual([signalTrade], fills, 28);
    expect(row!.actual!.entryPrice).toBeCloseTo(25, 9);
    expect(row!.actual!.exitPrice).toBeCloseTo(27.5, 9);
    expect(row!.actual!.sizeBtc).toBeCloseTo(0.08, 12);
    expect(row!.actual!.pnlXaut).toBeCloseTo(0.08 * 2.5, 9);
    expect(row!.actual!.returnPct).toBeCloseTo(10, 9);
    expect(row!.signalPnlXaut).toBeCloseTo(0.08 * 3, 9);
  });

  it("marks an open trade to the current price, and leaves unexecuted history as signal-only", () => {
    const open = { entryTime: Math.floor(t0 / 1000), entrySignal: 24, exitTime: null, exitSignal: null, status: "open" as const, xautReturnPct: 16.7 };
    const old = { entryTime: Math.floor(t0 / 1000) - 400 * 86_400, entrySignal: 20, exitTime: Math.floor(t0 / 1000) - 390 * 86_400, exitSignal: 21, status: "closed" as const, xautReturnPct: 5 };
    const rows = attachActual([old, open], fills.slice(0, 2), 30);
    expect(rows[0]!.status).toBe("open");
    expect(rows[0]!.actual!.returnPct).toBeCloseTo(20, 9); // 30 / 25 - 1
    expect(rows[0]!.actual!.pnlXaut).toBeCloseTo(0.08 * 5, 9);
    expect(rows[1]!.actual).toBeNull();
  });
});
