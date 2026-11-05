import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_9_0 = VersionInfo.of({
  version: '0.1.9:0',
  releaseNotes: {
    en_US: 'Idle-USDT sweeps now offer the whole excess above the USDT reserve (no extra 0.1% haircut), so the wallet lands within a few cents of the reserve.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
