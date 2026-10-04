/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'MTG Companion',
        short_name: 'MTG Companion',
        description: 'Table companion for in-person Magic: The Gathering games',
        display: 'standalone',
        orientation: 'any',
        background_color: '#101014',
        theme_color: '#101014',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,txt}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        runtimeCaching: [
          {
            // Card images: cache forever, first load wins.
            urlPattern: /^https:\/\/(cards|c\d)\.scryfall\.(io|com)\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'scryfall-images',
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test-setup.ts',
  },
});
