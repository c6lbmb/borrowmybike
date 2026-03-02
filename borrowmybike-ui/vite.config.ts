import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Auto-update service worker when you deploy new builds
      registerType: 'autoUpdate',

      // Generates the web manifest and injects registration
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon.png',
        'pwa-192.png',
        'pwa-512.png',
        'pwa-192-maskable.png',
        'pwa-512-maskable.png',
      ],

      manifest: {
        name: 'BorrowMyBike',
        short_name: 'BMB',
        description:
          'Safety-first Class 6 road-test bookings connecting test-takers with local mentors and road-test-ready bikes.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0b1f3b',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },

      workbox: {
        // Cache your build assets and enable basic offline support.
        // (This is a SPA; Cloudflare Pages still handles online routing via _redirects.)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff2,ttf,eot,json,txt}'],
        navigateFallback: '/index.html',
      },

      devOptions: {
        enabled: false,
      },
    }),
  ],
})
