import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_1_0 = VersionInfo.of({
  version: '0.1.1:0',
  releaseNotes: {
    en_US: 'Fix: reads the latest daily candles. Stale-data guard. Autopilot-style dashboard. Daily deployment cap.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
