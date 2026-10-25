import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({
  version: '0.1.0:0',
  releaseNotes: {
    en_US:
      'Initial release: accumulates XAUT on Bitfinex by rotating between XAUT and BTC with a mirrored Larsson Line (BTC priced in XAUT). Boots disabled and in dry-run mode. Optional strategy entry cap and new-money cap, both off by default.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
