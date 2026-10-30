import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_4_0 = VersionInfo.of({
  version: '0.1.4:0',
  releaseNotes: {
    en_US:
      'Removed the daily deployment cap (not wanted). Default order size is now $2,000 per order, one order at a time. Fee allowance in order sizing reduced (Bitfinex spot fees are zero).',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
