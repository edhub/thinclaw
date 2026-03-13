import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precache all static assets emitted by the build.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Don't precache highlight.js language chunks — they're huge and lazily loaded.
        globIgnores: ['**/highlight.js/**'],
      },
      manifest: {
        name: 'ThinClaw',
        short_name: 'ThinClaw',
        description: 'Lightweight AI chat — runs entirely in your browser',
        theme_color: '#5b6af5',
        background_color: '#0d0d10',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            // Same file, marked maskable so Android can apply its own shape.
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
