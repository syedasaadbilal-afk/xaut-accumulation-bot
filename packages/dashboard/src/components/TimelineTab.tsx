import type { StatusDto } from "../api.js";
import { card, fmtDate, fmtPct, fmtTs, h3, num, pctCls } from "../format.js";

/** Timeline tab: strategy trades, order fills, deposits seen, and the activity log. */
export function TimelineTab({ status }: { status: StatusDto | undefined }) {
  if (!status) return <div className="text-slate-500 p-6">Loading...</div>;
  const s = status;
  return (
    <div className="space-y-6 p-6">
      <div className={card}>
        <h3 className={h3}>Strategy trades (chart signals, newest first)</h3>
        <div className="overflow-x-auto">
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
                  <td colSpan={6} className="py-3 text-slate-500">No signals in the available history.</td>
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
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Signal results (next daily open after the confirmed close), in XAUT, before fees and slippage. A backtest of the rule, not of this account. Prices are XAUT per BTC. Wins: {s.summary.wins} of {s.summary.closed} closed.
        </p>
      </div>

      <div className={card}>
        <h3 className={h3}>Order fills</h3>
        <div className="overflow-x-auto">
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

      <div className={card}>
        <h3 className={h3}>Deposits and withdrawals seen</h3>
        <div className="overflow-x-auto">
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
                  <td className="py-1.5 pr-3 font-mono text-xs text-slate-400">{d.dist === null ? "" : `BTC ${fmtPct(d.dist * 100)} vs baseline`}</td>
                  <td className="py-1.5 text-xs text-slate-300">{d.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <h3 className={h3}>Activity log</h3>
        <div className="overflow-x-auto">
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
    </div>
  );
}
