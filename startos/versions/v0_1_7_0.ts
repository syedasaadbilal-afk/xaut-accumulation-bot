import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_7_0 = VersionInfo.of({
  version: '0.1.7:0',
  releaseNotes: {
    en_US: 'USDT amounts on the Status tab are now rounded down to the cent, matching what Bitfinex shows (499.99, not 500.00).',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
