import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_0_0 = VersionInfo.of({
  version: '0.1.0:0',
  releaseNotes: {
    en_US: 'Initial release: accumulates XAUT on Bitfinex by rotating between XAUT and BTC with a mirrored Larsson Line.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
