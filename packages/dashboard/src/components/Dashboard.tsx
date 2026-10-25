import { useEffect, useState } from "react";
import {
  clearHeldBack,
  fetchStatus,
  runNow,
  saveConfig,
  saveSecrets,
  type BarDto,
  type BotConfigDto,
  type SignalDto,
  type StatusDto,
} from "../api.js";

const inputCls = "bg-ink-950 border border-slate-800 rounded px-2 py-1.5 text-sm text-slate-200 w-28";
const btnCls = "px-3 py-1.5 rounded text-sm font-medium bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50 border border-slate-700";
const card = "bg-ink-900 border border-slate-800 rounded-lg p-3";
const h3 = "text-xs font-semibold tracking-wider text-slate-300 uppercase mb-2";

const REGIME_COLOR = { orange: "#f59e0b", navy: "#3b82f6", gray: "#94a3b8" } as const;

const fmtDate = (s: number | null) => (s === null ? "-" : new Date(s * 1000).toISOString().slice(0, 10));
const fmtTs = (ms: number | null) => (ms === null ? "-" : new Date(ms).toISOString().replace("T", " ").slice(0, 16));
const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const pctCls = (n: number | null | undefined) => (n === null || n === undefined ? "text-slate-500" : n >= 0 ? "text-emerald-400" : "text-red-400");
const num = (n: number | null | undefined, d = 4) => (n === null || n === undefined ? "-" : n.toFixed(d));

function Stat({ label, value, cls = "text-slate-200", sub }: { label: string; value: string; cls?: string; sub?: string }) {
  return (
    <div className={card}>
      <div className="text-[11px] tracking-wider text-slate-500 uppercase mb-1">{label}</div>
      <div className={`text-lg font-semibold font-mono ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Chart({ bars, signals }: { bars: BarDto[]; signals: SignalDto[] }) {
  const W = 960;
  const H = 340;
  const padL = 8;
  const padR = 64;
  const padT = 12;
  const padB = 24;
  if (bars.length < 2) return <div className="text-sm text-slate-500">Not enough candles yet.</div>;
  const vals: number[] = [];
  for (const b of bars) {
    vals.push(b.high, b.low);
    if (b.v1 !== null) vals.push(b.v1);
    if (b.v2 !== null) vals.push(b.v2);
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.01)] ?? sorted[0]!;
  const hi = sorted[Math.ceil(sorted.length * 0.99) - 1] ?? sorted[sorted.length - 1]!;
  const span = Math.max(hi - lo, 1e-12);
  const min = lo - span * 0.05;
  const max = hi + span * 0.05;
  const x = (i: number) => padL + (i / (bars.length - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (Math.min(Math.max(v, min), max) - min) / (max - min)) * (H - padT - padB);
  const cw = Math.max(1.5, ((W - padL - padR) / bars.length) * 0.6);
  const idxByTime = new Map(bars.map((b, i) => [b.time, i]));

  const bands: Array<{ regime: keyof typeof REGIME_COLOR; from: number; to: number }> = [];
  bars.forEach((b, i) => {
    if (!b.regime || b.v1 === null || b.v2 === null) return;
    const last = bands[bands.length - 1];
    if (last && last.regime === b.regime && last.to === i - 1) last.to = i;
    else bands.push({ regime: b.regime, from: i, to: i });
  });
  const line = (key: "v1" | "v2", from: number, to: number) =>
    bars
      .slice(from, to + 1)
      .map((b, k) => `${k === 0 ? "M" : "L"}${x(from + k).toFixed(1)},${y(b[key] as number).toFixed(1)}`)
      .join(" ");
  const poly = (from: number, to: number) => {
    const top = bars.slice(from, to + 1).map((b, k) => `${x(from + k).toFixed(1)},${y(b.v1 as number).toFixed(1)}`);
    const bot = bars
      .slice(from, to + 1)
      .map((b, k) => `${x(from + k).toFixed(1)},${y(b.v2 as number).toFixed(1)}`)
      .reverse();
    return [...top, ...bot].join(" ");
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + (max - min) * f);
  const labelEvery = Math.ceil(bars.length / 8);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="BTC priced in XAUT, daily candles with Larsson lines">
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#1e293b" strokeWidth={1} />
          <text x={W - padR + 6} y={y(t) + 4} fontSize={10} fill="#64748b" fontFamily="monospace">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {bands.map((b, k) => (
        <polygon key={k} points={poly(b.from, b.to)} fill={REGIME_COLOR[b.regime]} fillOpacity={0.2} />
      ))}
      {bars.map((b, i) => {
        const up = b.close >= b.open;
        const c = up ? "#34d399" : "#f87171";
        return (
          <g key={b.time} opacity={b.confirmed ? 1 : 0.5}>
            <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} stroke={c} strokeWidth={1} />
            <rect x={x(i) - cw / 2} y={Math.min(y(b.open), y(b.close))} width={cw} height={Math.max(1, Math.abs(y(b.open) - y(b.close)))} fill={c} />
          </g>
        );
      })}
      {bands.map((b, k) => (
        <g key={`l${k}`}>
          <path d={line("v1", b.from, b.to)} fill="none" stroke={REGIME_COLOR[b.regime]} strokeWidth={1.6} />
          <path d={line("v2", b.from, b.to)} fill="none" stroke={REGIME_COLOR[b.regime]} strokeWidth={2.4} />
        </g>
      ))}
      {signals.map((s) => {
        const i = idxByTime.get(s.signalBarTime);
        if (i === undefined) return null;
        const enter = s.action === "enter";
        const cy = enter ? y(bars[i]!.low) + 14 : y(bars[i]!.high) - 14;
        return (
          <polygon
            key={`${s.signalBarTime}${s.action}`}
            points={enter ? `${x(i)},${cy - 7} ${x(i) - 6},${cy + 4} ${x(i) + 6},${cy + 4}` : `${x(i)},${cy + 7} ${x(i) - 6},${cy - 4} ${x(i) + 6},${cy - 4}`}
            fill={enter ? "#34d399" : "#f87171"}
          />
        );
      })}
      {bars.map((b, i) =>
        i % labelEvery === 0 ? (
          <text key={`t${b.time}`} x={x(i)} y={H - 6} fontSize={10} fill="#64748b" textAnchor="middle" fontFamily="monospace">
            {fmtDate(b.time).slice(5)}
          </text>
        ) : null
      )}
    </svg>
  );
}

function NumField({ label, value, onChange, suffix, disabled }: { label: string; value: string; onChange: (v: string) => void; suffix?: string; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      {label}
      <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      {suffix && <span className="text-slate-500">{suffix}</span>}
    </label>
  );
}

function Settings({ s, reload }: { s: StatusDto; reload: () => Promise<void> }) {
  const c = s.config;
  const [enabled, setEnabled] = useState(c.enabled);
  const [mode, setMode] = useState(c.mode);
  const [chunk, setChunk] = useState(String(c.chunkUsd));
  const [minTrade, setMinTrade] = useState(String(c.minTradeUsd));
  const [posCap, setPosCap] = useState(String(c.positionCapXaut));
  const [sEn, setSEn] = useState(c.strategyCap.enabled);
  const [sPct, setSPct] = useState(String(c.strategyCap.maxDistPct));
  const [nEn, setNEn] = useState(c.newMoneyCap.enabled);
  const [nPct, setNPct] = useState(String(c.newMoneyCap.maxDistPct));
  const [nLump, setNLump] = useState(String(c.newMoneyCap.minLumpPct));
  const [note, setNote] = useState<string | undefined>(undefined);

  async function save() {
    if (mode === "LIVE" && c.mode !== "LIVE" && !window.confirm("Switch to LIVE? With the bot enabled this places REAL orders on Bitfinex.")) return;
    const next: BotConfigDto = {
      enabled,
      mode,
      chunkUsd: Number(chunk),
      minTradeUsd: Number(minTrade),
      positionCapXaut: Number(posCap),
      strategyCap: { enabled: sEn, maxDistPct: Number(sPct) },
      newMoneyCap: { enabled: nEn, maxDistPct: Number(nPct), minLumpPct: Number(nLump) },
    };
    const r = await saveConfig(next);
    setNote(r.ok ? "Saved." : (r.error ?? "Save failed"));
    if (r.ok) await reload();
  }

  return (
    <div className={card}>
      <h3 className={h3}>Settings</h3>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Bot enabled
          </label>
          <label className="flex items-center gap-2">
            Trading mode
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as "DRY_RUN" | "LIVE")}>
              <option value="DRY_RUN">DRY_RUN (no orders)</option>
              <option value="LIVE">LIVE (real orders)</option>
            </select>
          </label>
          <NumField label="Order size" value={chunk} onChange={setChunk} suffix="USD per order" />
          <NumField label="Ignore below" value={minTrade} onChange={setMinTrade} suffix="USD" />
          <NumField label="Position cap" value={posCap} onChange={setPosCap} suffix="XAUT in BTC at once (0 = none)" />
        </div>

        <div className="border border-slate-800 rounded p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-slate-400">Strategy entry cap (part of the strategy)</div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={sEn} onChange={(e) => setSEn(e.target.checked)} />
              Use it
            </label>
            <NumField label="Skip entries when BTC is more than" value={sPct} onChange={setSPct} suffix="% above the baseline" />
          </div>
          <p className="text-xs text-slate-500">
            Applies to the strategy's own flat-to-BTC entry only. An open BTC position and exits are never affected. The entry is re-checked every day, so it can still happen later once price comes back within the cap.
          </p>
        </div>

        <div className="border border-slate-800 rounded p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-slate-400">New-money cap (money you add)</div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={nEn} onChange={(e) => setNEn(e.target.checked)} />
              Use it
            </label>
            <NumField label="Hold new XAUT back when BTC is more than" value={nPct} onChange={setNPct} suffix="% above the baseline" />
            <NumField label="Only for deposits of at least" value={nLump} onChange={setNLump} suffix="% of the account (0 = all)" />
          </div>
          <p className="text-xs text-slate-500">
            Applies only to XAUT you deposit while the strategy is already holding BTC. Held-back XAUT is converted when price returns within the cap, or stays XAUT when the strategy exits. The money already working is not touched.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className={btnCls} onClick={() => void save()}>
            Save settings
          </button>
          {note && <span className="text-slate-400">{note}</span>}
        </div>
      </div>
    </div>
  );
}

function Credentials({ configured, reload }: { configured: boolean; reload: () => Promise<void> }) {
  const [key, setKey] = useState("");
  const [secret, setSecret] = useState("");
  const [note, setNote] = useState<string | undefined>(undefined);
  async function save() {
    const r = await saveSecrets(key, secret);
    setNote(r.ok ? "Saved." : (r.error ?? "Save failed"));
    if (r.ok) {
      setKey("");
      setSecret("");
      await reload();
    }
  }
  return (
    <div className={card}>
      <h3 className={h3}>Bitfinex API key {configured ? "(saved)" : "(not set)"}</h3>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input className={`${inputCls} w-64`} placeholder="API key" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        <input className={`${inputCls} w-64`} type="password" placeholder="API secret" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
        <button className={btnCls} onClick={() => void save()} disabled={!key || !secret}>
          Save key
        </button>
        {note && <span className="text-slate-400">{note}</span>}
      </div>
      <p className="text-xs text-slate-500 mt-2">
        Use a dedicated Bitfinex sub-account holding only the XAUT/BTC you want this bot to manage. Permissions: read wallets and orders, create and cancel orders. No withdrawals. Anything the bot did not trade (including trades you make by hand) is read as a deposit or withdrawal.
      </p>
    </div>
  );
}

export function Dashboard() {
  const [s, setS] = useState<StatusDto | undefined>(undefined);
  const [msg, setMsg] = useState<string | undefined>(undefined);

  async function reload() {
    setS(await fetchStatus());
  }
  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!s) return <div className="p-6 text-slate-400">Loading...</div>;
  const live = s.config.mode === "LIVE";
  const lr = s.state.lastResult;
  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto">
      <div
        className={`rounded p-3 text-sm border ${
          !s.config.enabled
            ? "bg-slate-900 border-slate-700 text-slate-300"
            : live
              ? "bg-amber-950/30 border-amber-800 text-amber-200"
              : "bg-blue-950/30 border-blue-900 text-blue-200"
        }`}
      >
        {!s.config.enabled
          ? "Bot is disabled. It reads the market and wallets but places no orders."
          : live
            ? "LIVE: real orders are placed on Bitfinex when the strategy and your wallets call for it."
            : "DRY_RUN: the bot only logs what it would do. No orders are placed."}
      </div>
      {s.error && <div className="bg-red-950/40 border border-red-900 rounded p-3 text-sm text-red-300">{s.error}</div>}
      {!s.configured && <div className="bg-amber-950/30 border border-amber-900 rounded p-3 text-sm text-amber-200">No Bitfinex API key yet. Add one below to let the bot read your wallets.</div>}
      {s.warmup && (
        <div className="bg-amber-950/30 border border-amber-900 rounded p-3 text-sm text-amber-200">
          Only {s.barsCount} daily bars of history; the lines are most reliable after about 90.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Holding now" value={s.holding ?? "-"} sub={s.wallets ? `${num(s.wallets.xaut, 4)} XAUT · ${num(s.wallets.btc, 6)} BTC` : undefined} />
        <Stat
          label="Strategy wants"
          value={s.desired ?? "-"}
          cls={s.desired === "BTC" ? "text-amber-400" : "text-yellow-200"}
          sub={s.caps.strategy.blockingNow ? `entry cap is blocking (uncapped: ${s.desiredUncapped})` : `regime ${s.regime ?? "n/a"}`}
        />
        <Stat label="BTC above baseline" value={s.dist === null ? "-" : fmtPct(s.dist * 100)} sub="BTC priced in XAUT, last confirmed close" />
        <Stat label="Account (XAUT)" value={num(s.equityXaut, 4)} sub={s.price ? `1 XAUT = ${s.price.toFixed(6)} BTC` : undefined} />
      </div>

      <div className={card}>
        <h3 className={h3}>BTC priced in XAUT · daily · Larsson lines (15 fast / 29 baseline SMMA of hl2)</h3>
        <Chart bars={s.bars} signals={s.signals} />
        <p className="text-xs text-slate-500 mt-2">
          This is the XAUT/BTC chart upside down. Orange = hold BTC, navy/gray = hold XAUT. Green up arrow = enter BTC, red down arrow = back to XAUT. A rising line means BTC is gaining on gold.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={card}>
          <h3 className={h3}>Caps right now</h3>
          <div className="text-sm space-y-2">
            <div>
              <span className="text-slate-400">Strategy entry cap: </span>
              {s.caps.strategy.enabled ? `on, ${s.caps.strategy.maxDistPct}% ` : "off"}
              {s.caps.strategy.enabled && (s.caps.strategy.blockingNow ? <span className="text-amber-400">(blocking the entry now)</span> : <span className="text-slate-500">(not blocking)</span>)}
            </div>
            <div>
              <span className="text-slate-400">New-money cap: </span>
              {s.caps.newMoney.enabled ? `on, ${s.caps.newMoney.maxDistPct}%, deposits >= ${s.caps.newMoney.minLumpPct}% of account ` : "off"}
              {s.caps.newMoney.enabled && (s.caps.newMoney.wouldHoldBackNow ? <span className="text-amber-400">(a new deposit would be held back now)</span> : <span className="text-slate-500">(a new deposit would be deployed now)</span>)}
            </div>
            <div>
              <span className="text-slate-400">Held back: </span>
              {num(s.caps.newMoney.heldBackXaut, 6)} XAUT
              {s.caps.newMoney.heldBackXaut > 0 && (
                <button
                  className={`${btnCls} ml-3`}
                  onClick={async () => {
                    await clearHeldBack();
                    await reload();
                  }}
                >
                  Release now
                </button>
              )}
            </div>
            <div>
              <span className="text-slate-400">Position cap: </span>
              {s.config.positionCapXaut > 0 ? `${s.config.positionCapXaut} XAUT` : "off"}
            </div>
          </div>
        </div>
        <div className={card}>
          <h3 className={h3}>Last tick</h3>
          <div className="text-sm space-y-1">
            <div className="text-slate-300">{lr ? `${lr.action}: ${lr.detail}` : "No tick yet."}</div>
            <div className="text-xs text-slate-500">{fmtTs(s.state.lastTickAt)} UTC</div>
            {s.state.strandedUst > 0 && <div className="text-amber-400 text-xs">{num(s.state.strandedUst, 2)} USDT left over from a half-finished rotation; it is spent first next tick.</div>}
            <button
              className={btnCls}
              onClick={async () => {
                await runNow();
                setMsg("Tick started.");
                setTimeout(() => void reload(), 4000);
              }}
            >
              Run a tick now
            </button>
            {msg && <span className="text-slate-400 ml-2 text-xs">{msg}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Signal trades" value={`${s.summary.trades} (${s.summary.closed} closed)`} />
        <Stat label="Wins (in XAUT)" value={`${s.summary.wins} / ${s.summary.closed}`} />
        <Stat label="Strategy XAUT gain*" value={fmtPct(s.summary.signalXautReturnPct)} cls={pctCls(s.summary.signalXautReturnPct)} sub="compounded, signal prices" />
        <Stat label="This account's XAUT gain" value={fmtPct(s.summary.accountXautReturnPct)} cls={pctCls(s.summary.accountXautReturnPct)} sub="since the bot started, deposits removed" />
      </div>

      <div className={`${card} overflow-x-auto`}>
        <h3 className={h3}>Strategy trades (newest first)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-500 text-left">
              <th className="pr-3 pb-1 font-medium">Status</th>
              <th className="pr-3 pb-1 font-medium">Entry (to BTC)</th>
              <th className="pr-3 pb-1 font-medium">Exit (to XAUT)</th>
              <th className="pr-3 pb-1 font-medium text-right">Entry price</th>
              <th className="pr-3 pb-1 font-medium text-right">Exit price</th>
              <th className="pb-1 font-medium text-right">XAUT gained</th>
            </tr>
          </thead>
          <tbody>
            {s.trades.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-slate-500">
                  No signals in the available history.
                </td>
              </tr>
            )}
            {s.trades.map((t) => (
              <tr key={t.entryTime} className="border-t border-slate-800">
                <td className="py-1.5 pr-3">{t.status}</td>
                <td className="py-1.5 pr-3 font-mono">{fmtDate(t.entryTime)}</td>
                <td className="py-1.5 pr-3 font-mono">{fmtDate(t.exitTime)}</td>
                <td className="py-1.5 pr-3 font-mono text-right">{num(t.entrySignal, 3)}</td>
                <td className="py-1.5 pr-3 font-mono text-right">{t.status === "open" ? "mark" : num(t.exitSignal, 3)}</td>
                <td className={`py-1.5 font-mono text-right ${pctCls(t.xautReturnPct)}`}>{fmtPct(t.xautReturnPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-2">
          * Chart-signal results (next daily open after the confirmed close), in XAUT, before fees and slippage and ignoring your caps' effect on amounts. History is a backtest of the rule, not of this account. Prices are XAUT per BTC.
        </p>
      </div>

      <Settings key={JSON.stringify(s.config)} s={s} reload={reload} />
      <Credentials configured={s.configured} reload={reload} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={`${card} overflow-x-auto`}>
          <h3 className={h3}>Deposits and withdrawals seen</h3>
          <table className="w-full text-sm">
            <tbody>
              {s.deposits.length === 0 && (
                <tr>
                  <td className="py-2 text-slate-500">None yet. A wallet change the bot did not cause is logged here.</td>
                </tr>
              )}
              {s.deposits.map((d) => (
                <tr key={d.id} className="border-t border-slate-800 align-top">
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-400 whitespace-nowrap">{fmtTs(d.ts)}</td>
                  <td className={`py-1.5 pr-3 font-mono ${d.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {d.amount >= 0 ? "+" : ""}
                    {num(d.amount, d.asset === "BTC" ? 6 : 4)} {d.asset}
                  </td>
                  <td className="py-1.5 text-xs text-slate-300">{d.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`${card} overflow-x-auto`}>
          <h3 className={h3}>Order fills</h3>
          <table className="w-full text-sm">
            <tbody>
              {s.fills.length === 0 && (
                <tr>
                  <td className="py-2 text-slate-500">No orders yet.</td>
                </tr>
              )}
              {s.fills.map((f) => (
                <tr key={f.id} className="border-t border-slate-800">
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-400 whitespace-nowrap">{fmtTs(f.ts)}</td>
                  <td className={`py-1.5 pr-3 ${f.side === "buy" ? "text-emerald-400" : "text-red-400"}`}>{f.side}</td>
                  <td className="py-1.5 pr-3 font-mono">{f.symbol}</td>
                  <td className="py-1.5 pr-3 font-mono text-right">{num(f.base, 6)}</td>
                  <td className="py-1.5 font-mono text-right">{num(f.price, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <h3 className={h3}>Activity log</h3>
        <table className="w-full text-sm">
          <tbody>
            {s.events.map((e) => (
              <tr key={e.id} className="border-t border-slate-800 align-top">
                <td className="py-1.5 pr-3 font-mono text-xs text-slate-400 whitespace-nowrap">{fmtTs(e.ts)}</td>
                <td className="py-1.5 pr-3 text-xs text-slate-500">{e.kind}</td>
                <td className={`py-1.5 text-xs ${e.kind === "error" ? "text-red-300" : "text-slate-300"}`}>{e.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
