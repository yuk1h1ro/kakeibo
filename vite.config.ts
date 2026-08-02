import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages のプロジェクトサイト (https://<user>.github.io/kakeibo/) で動かすための base。
// 独自ドメインやルート配信にする場合は '/' に変更する。
export default defineConfig({
  base: process.env.BASE_PATH ?? '/kakeibo/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        name: '家計簿',
        short_name: '家計簿',
        description: '自分専用の家計簿アプリ(彼女の預かり金管理つき)',
        lang: 'ja',
        display: 'standalone',
        start_url: '.',
        background_color: '#f9f9f7',
        theme_color: '#2a78d6',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
