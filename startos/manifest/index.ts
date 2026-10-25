import { setupManifest } from '@start9labs/start-sdk'
import { long, short } from './i18n'

export const manifest = setupManifest({
  id: 'xaut-accumulation-bot',
  title: 'XAUT Accumulation Bot',
  license: 'MIT',
  packageRepo: 'https://github.com/syedasaadbilal-afk/xaut-accumulation-bot',
  upstreamRepo: 'https://github.com/syedasaadbilal-afk/xaut-accumulation-bot',
  marketingUrl: 'https://github.com/syedasaadbilal-afk/xaut-accumulation-bot',
  donationUrl: 'https://github.com/syedasaadbilal-afk/xaut-accumulation-bot',
  description: { short, long },
  volumes: ['main'],
  images: {
    xaut: {
      source: { dockerTag: 'ghcr.io/syedasaadbilal-afk/xaut-accumulation-bot:latest' },
      arch: ['x86_64', 'aarch64'],
    },
  },
  alerts: {
    install: null,
    update: null,
    uninstall: null,
    restore: null,
    start: null,
    stop: null,
  },
  dependencies: {},
})
