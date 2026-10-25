import { useState } from "react";
import { saveConfig, saveSecrets, type BotConfigDto, type StatusDto } from "../api.js";
import { btnCls, card, h3, inputCls } from "../format.js";

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
  const [chunk, setChunk] = useState(String(c.chunkUsd));
  const [minTrade, setMinTrade] = useState(String(c.minTradeUsd));
  const [posCap, setPosCap] = useState(String(c.positionCapXaut));
  const [ddEn, setDdEn] = useState(c.dailyDeployCap.enabled);
  const [ddUsd, setDdUsd] = useState(String(c.dailyDeployCap.maxUsd));
  const [sEn, setSEn] = useState(c.strategyCap.enabled);
  const [sPct, setSPct] = useState(String(c.strategyCap.maxDistPct));
  const [nEn, setNEn] = useState(c.newMoneyCap.enabled);
  const [nPct, setNPct] = useState(String(c.newMoneyCap.maxDistPct));
  const [nLump, setNLump] = useState(String(c.newMoneyCap.minLumpPct));
  const [note, setNote] = useState<string | undefined>(undefined);

  async function save() {
    const next: BotConfigDto = {
      enabled: c.enabled,
      mode: c.mode,
      chunkUsd: Number(chunk),
      minTradeUsd: Number(minTrade),
      positionCapXaut: Number(posCap),
      dailyDeployCap: { enabled: ddEn, maxUsd: Number(ddUsd) },
      strategyCap: { enabled: sEn, maxDistPct: Number(sPct) },
      newMoneyCap: { enabled: nEn, maxDistPct: Number(nPct), minLumpPct: Number(nLump) },
    };
    const r = await saveConfig(next);
    setNote(r.ok ? "Saved." : (r.error ?? "Save failed"));
    if (r.ok) await reload();
  }

  return (
    <div className={card}>
      <h3 className={h3}>Settings (run mode is set on the Status tab)</h3>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-4">
          <NumField label="Order size" value={chunk} onChange={setChunk} suffix="USD per order" />
          <NumField label="Ignore below" value={minTrade} onChange={setMinTrade} suffix="USD" />
          <NumField label="Position cap" value={posCap} onChange={setPosCap} suffix="XAUT in BTC at once (0 = none)" />
        </div>

        <div className="border border-slate-800 rounded p-3 space-y-2">
          <div className="text-xs uppercase tracking-wider text-slate-400">Daily deployment cap</div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ddEn} onChange={(e) => setDdEn(e.target.checked)} />
              Use it
            </label>
            <NumField label="Move at most" value={ddUsd} onChange={setDdUsd} suffix="USD into BTC per rolling 24h" />
          </div>
          <p className="text-xs text-slate-500">
            Limits money going from XAUT into BTC, so a big deposit or the first deployment is drip-fed instead of hitting the order book at once. The rest follows as the 24h window rolls. Moving back to XAUT is never capped.
          </p>
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


export function ConfigTab({ status, reload }: { status: StatusDto | undefined; reload: () => Promise<void> }) {
  if (!status) return <div className="text-slate-500 p-6">Loading...</div>;
  return (
    <div className="space-y-6 p-6">
      <Settings key={JSON.stringify(status.config)} s={status} reload={reload} />
      <Credentials configured={status.configured} reload={reload} />
    </div>
  );
}
