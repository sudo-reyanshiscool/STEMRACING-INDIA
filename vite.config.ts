import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.woff2', 'brand/*.png'],
      manifest: {
        name: 'STEM Racing India Digital Scrutineering',
        short_name: 'Scrutineering',
        description: 'Offline scrutineering checklist for STEM Racing cars.',
        start_url: '/',
        display: 'standalone',
        background_color: '#05000B',
        theme_color: '#05000B',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'] },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
});
