import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const current = VersionInfo.of({
  version: '0.1.13:0',
  releaseNotes: {
    en_US:
      'XAUT reserve now closes a last small gap below the exchange minimum order by buying the minimum, so the reserve ends at or just above the target (for example 3.5007 instead of 3.4988). New Use it tick box on the Reserves settings switches the reserves off and on without losing the amounts.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
