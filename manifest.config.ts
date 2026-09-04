import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  minimum_chrome_version: '116',
  name: 'Loudness DD',
  description: 'LUFS-based tab volume balancer for Chrome',
  version: process.env.npm_package_version ?? '0.0.0',
  default_locale: 'en',
  icons: {
    '16': 'logo@16w.png',
    '32': 'logo@32w.png',
    '48': 'logo@48w.png',
    '128': 'logo@128w.png',
  },
  action: {
    default_popup: 'index.html',
    default_icon: {
      '16': 'logo@16w.png',
      '32': 'logo@32w.png',
    },
  },
  background: {
    service_worker: 'src/background.ts',
    type: 'module',
  },
  permissions: ['tabCapture', 'tabs', 'activeTab', 'offscreen', 'storage'],
})
