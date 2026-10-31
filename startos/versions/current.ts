import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({
  version: '0.1.8:0',
  releaseNotes: {
    en_US:
      'Any balance that is not USDT, BTC or XAUT (USD, other coins with a USDT pair) is now converted to USDT and swept into the strategy asset. USD goes through USDT/USD; amounts below the pair minimum order are left alone. Reserves are never touched.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
