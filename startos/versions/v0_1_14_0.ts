import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_14_0 = VersionInfo.of({
  version: '0.1.14:0',
  releaseNotes: {
    en_US:
      'Leftovers below the exchange minimum order (for example 0.0009 XAUT above the reserve) are no longer treated as something to convert, so the bot stays idle instead of logging empty rotations.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
