import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({
  version: '0.1.2:0',
  releaseNotes: {
    en_US:
      'Timeline now matches the BTC Yield Autopilot: an executions table built from real order fills, and a TradingView-style trades table that shows the actual fill price next to the signal price, with net PnL in XAUT, return, win rate and closed trades.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
