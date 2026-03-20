import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Stub out pi-ai provider modules that are not used in this app.
 *
 * Only three provider APIs are configured in models.ts:
 *   - anthropic-messages  → providers/anthropic.js
 *   - google-generative-ai → providers/google.js
 *   - openai-completions   → providers/openai-completions.js
 *
 * Every other provider (mistral, azure, vertex, gemini-cli, openai-responses,
 * openai-codex-responses, amazon-bedrock) is intercepted here and replaced with
 * an empty module so Rollup never bundles their SDKs (e.g. @mistralai/mistralai).
 *
 * If a stubbed provider is accidentally called at runtime, the existing
 * createLazyStream error-handler in register-builtins.js catches the TypeError
 * and surfaces a readable error message in the chat.
 */
const UNUSED_PI_AI_PROVIDERS = new Set([
  'mistral',
  'azure-openai-responses',
  'google-gemini-cli',
  'google-vertex',
  'openai-codex-responses',
  'openai-responses',
  'amazon-bedrock',
])

function stubUnusedPiAiProviders(): Plugin {
  const VIRTUAL_ID = '\0pi-ai-provider-stub'
  return {
    name: 'stub-unused-pi-ai-providers',
    resolveId(id, importer) {
      if (!importer?.includes('@mariozechner/pi-ai')) return null
      for (const name of UNUSED_PI_AI_PROVIDERS) {
        if (id === `./${name}.js` || id.endsWith(`/providers/${name}.js`)) {
          return VIRTUAL_ID
        }
      }
      return null
    },
    load(id) {
      if (id === VIRTUAL_ID) {
        // Empty module — any property access returns undefined, which the
        // register-builtins createLazyStream error handler catches gracefully.
        return 'export default {}'
      }
      return null
    },
  }
}

export default defineConfig({
  server: {
    forwardConsole: true,
  },
  plugins: [
    stubUnusedPiAiProviders(),
    tailwindcss(),
    sveltekit(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,       // disable HTML injection — SvelteKit SSG overwrites it anyway
                                   // registration is handled via virtual:pwa-register in layout
      devOptions: {
        enabled: true,            // serve manifest + SW in dev
      },
      // Precache all static assets emitted by the build.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Don't precache highlight.js language chunks — they're huge and lazily loaded.
        globIgnores: ['**/highlight.js/**'],
        // SPA fallback: all navigation requests that miss the cache serve index.html.
        navigateFallback: '/index.html',
      },
      manifest: {
        name: 'ThinClaw',
        short_name: 'ThinClaw',
        description: 'Lightweight AI chat — runs entirely in your browser',
        theme_color: '#FF9940',
        background_color: '#FAFAFA',
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
