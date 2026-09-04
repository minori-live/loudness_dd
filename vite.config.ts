import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { crx } from '@crxjs/vite-plugin'
import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import zipPack from 'vite-plugin-zip-pack'

import manifest from './manifest.config.ts'
import i18nLocalesPlugin from './plugins/i18n-locales.ts'

const appVersion = process.env.npm_package_version ?? '0.0.0'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    UnoCSS(),
    vue(),
    vueDevTools(),
    VueI18nPlugin({
      include: resolve(import.meta.dirname, 'src/locales/**'),
      strictMessage: false,
    }),
    i18nLocalesPlugin(),
    crx({ manifest }),
    zipPack({ outDir: 'release', outFileName: `loudness-dd-v${appVersion}.zip` }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        offscreen: resolve(import.meta.dirname, 'offscreen.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    ws: {
      port: 5173,
    },
    cors: {
      origin: '*',
    },
  },
})
