import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'
export const v_0_1_6_0 = VersionInfo.of({
  version: '0.1.6:0',
  releaseNotes: {
    en_US:
      'XAUT reserve: when it is short, idle USDT in the wallet is spent on XAUT first, and BTC is only sold for what is still missing.',
  },
  migrations: { up: async ({ effects }) => {}, down: IMPOSSIBLE },
})
