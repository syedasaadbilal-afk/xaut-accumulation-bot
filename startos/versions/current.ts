import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({
  version: '0.1.5:0',
  releaseNotes: {
    en_US:
      'Loads the full daily candle history (cached 2 min) so the trade history matches TradingView exactly. Idle USDT sitting in the wallet is now swept into whatever the strategy wants (respecting the position cap). Timeline and Status now show cumulative return and CAGR for the chart signals. New USDT reserve setting (default 0): the bot sells its position into USDT up to that amount and keeps it parked; set it to 0 to put the USDT back to work.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
