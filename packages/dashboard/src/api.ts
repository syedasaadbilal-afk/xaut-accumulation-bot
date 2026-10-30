export type BotMode = "DRY_RUN" | "LIVE";

export interface BotConfigDto {
  enabled: boolean;
  mode: BotMode;
  chunkUsd: number;
  minTradeUsd: number;
  positionCapXaut: number;
  strategyCap: { enabled: boolean; maxDistPct: number };
  newMoneyCap: { enabled: boolean; maxDistPct: number; minLumpPct: number };
}

export interface BarDto {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  v1: number | null;
  v2: number | null;
  regime: "orange" | "navy" | "gray" | null;
  confirmed: boolean;
}

export interface SignalDto {
  signalBarTime: number;
  action: "enter" | "exit";
  signalPrice: number | null;
  execTime: number;
}

export interface TradeDto {
  entryTime: number;
  entrySignal: number | null;
  exitTime: number | null;
  exitSignal: number | null;
  status: "open" | "closed";
  xautReturnPct: number | null;
  actual: { entryPrice: number | null; exitPrice: number | null; sizeBtc: number; pnlXaut: number | null; returnPct: number | null } | null;
  signalPnlXaut: number | null;
}

export interface ExecutionDto {
  rotationId: string;
  ts: number;
  kind: "to_btc" | "to_xaut" | "sweep_btc" | "sweep_xaut";
  soldAsset: "XAUT" | "BTC" | null;
  sold: number;
  boughtAsset: "XAUT" | "BTC";
  bought: number;
  xautUsd: number | null;
  btcUsd: number | null;
  orders: number;
  ratio: number | null;
}

export interface StatusDto {
  configured: boolean;
  config: BotConfigDto;
  state: { heldBackXaut: number; strandedUst: number; lastResult: { action: string; detail: string; at: number } | null; lastTickAt: number | null };
  error: string | null;
  price: number | null;
  usdPerXaut: number | null;
  usdPerBtc: number | null;
  wallets: { xaut: number; btc: number; xautAvail: number; btcAvail: number; ustAvail: number } | null;
  walletRows: Array<{ type: string; currency: string; balance: number; availableBalance: number }> | null;
  equityXaut: number | null;
  holding: "BTC" | "XAUT" | "MIXED" | "EMPTY" | null;
  desired: "BTC" | "XAUT" | null;
  desiredUncapped: "BTC" | "XAUT" | null;
  regime: "orange" | "navy" | "gray" | null;
  dist: number | null;
  warmup: boolean;
  barsCount: number;
  caps: {
    strategy: { enabled: boolean; maxDistPct: number; blockingNow: boolean };
    newMoney: { enabled: boolean; maxDistPct: number; minLumpPct: number; wouldHoldBackNow: boolean; heldBackXaut: number };
  };
  bars: BarDto[];
  signals: SignalDto[];
  trades: TradeDto[];
  executions: ExecutionDto[];
  summary: { trades: number; closed: number; wins: number; signalXautReturnPct: number; accountXautReturnPct: number | null; actualClosed: number; actualWins: number; actualNetPnlXaut: number };
  tickMs: number;
  snapshots: Array<{ ts: number; xaut: number; btc: number; price: number; equityXaut: number }>;
  events: Array<{ id: number; ts: number; kind: string; summary: string; detail: string | null }>;
  fills: Array<{ id: number; ts: number; rotationId: string; symbol: string; side: "buy" | "sell"; base: number; price: number }>;
  deposits: Array<{ id: number; ts: number; asset: string; amount: number; valueXaut: number; dist: number | null; action: string }>;
}

export async function fetchStatus(): Promise<StatusDto | undefined> {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) return undefined;
    return (await res.json()) as StatusDto;
  } catch {
    return undefined;
  }
}

async function send(method: "PUT" | "POST", url: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true } : { ok: false, error: json.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const saveConfig = (c: BotConfigDto) => send("PUT", "/api/config", c);
export const saveSecrets = (apiKey: string, apiSecret: string) => send("PUT", "/api/secrets", { apiKey, apiSecret });
export const runNow = () => send("POST", "/api/run-now");
export const clearHeldBack = () => send("POST", "/api/clear-held-back");

export const setMode = (mode: "DRY_RUN" | "LIVE" | "PAUSED") => send("PUT", "/api/mode", { mode });
