import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Stub out pi-ai provider modules that are not used in this app.
 *
 * Only two provider APIs are configured in models.ts:
 *   - anthropic-messages   → providers/anthropic.js
 *   - google-generative-ai → providers/google.js
 *
 * Every other provider (mistral, azure, vertex, gemini-cli, openai-responses,
 * openai-codex-responses, openai-completions, amazon-bedrock) is intercepted
 * here and replaced with an empty module so Rollup never bundles their SDKs.
 *
 * Stubbing strategy:
 *
 * 1. PROVIDER FILES — resolveId() + transform(): intercept ./mistral.js etc.
 *    from within @mariozechner/pi-ai so the real file is never parsed.
 *
 * 2. SDK PACKAGES — resolveId(): intercept @mistralai/mistralai etc.
 *    unconditionally so they never appear in the bundle even if a provider
 *    lazy-chunk slips through.
 *
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
  // 'openai-completions' — used by bailian (DashScope) provider
  'amazon-bedrock',
])

/**
 * SDK packages that should never appear in the browser bundle.
 * Stubbed unconditionally regardless of importer.
 *
 * The virtual stub module must export every named symbol that the stubbed
 * provider files import, otherwise Rolldown's static-analysis pass (which
 * runs before transform() fires) raises a MISSING_EXPORT error.
 */
const UNUSED_SDK_PACKAGES = new Set(['@mistralai/mistralai'])

/**
 * Named exports required by each stubbed SDK package.
 * Add entries here whenever a new package is added to UNUSED_SDK_PACKAGES.
 */
const SDK_NAMED_EXPORTS: Record<string, string[]> = {
  '@mistralai/mistralai': ['Mistral'],
}

function stubUnusedPiAiProviders(): Plugin {
  const VIRTUAL_ID = '\0pi-ai-provider-stub'
  return {
    name: 'stub-unused-pi-ai-providers',
    resolveId(id, importer) {
      // Stub SDK packages unconditionally (regardless of importer)
      if (UNUSED_SDK_PACKAGES.has(id)) return VIRTUAL_ID
      for (const pkg of UNUSED_SDK_PACKAGES) {
        if (id.startsWith(pkg + '/')) return VIRTUAL_ID
      }

      // Stub provider files when imported from within pi-ai
      if (!importer?.includes('@mariozechner/pi-ai')) return null
      for (const name of UNUSED_PI_AI_PROVIDERS) {
        if (id === `./${name}.js` || id.endsWith(`/providers/${name}.js`)) {
          return VIRTUAL_ID
        }
      }
      return null
    },
    // Fallback: replace provider file content before Rolldown parses its imports.
    // Needed for dynamic import paths or when resolveId is bypassed.
    transform(_code, id) {
      for (const name of UNUSED_PI_AI_PROVIDERS) {
        if (id.includes('@mariozechner/pi-ai') && id.endsWith(`/providers/${name}.js`)) {
          return { code: 'export default {}', map: null }
        }
      }
      return null
    },
    load(id) {
      if (id !== VIRTUAL_ID) return null
      // Build a stub that satisfies Rolldown's named-export static analysis.
      // The _s function acts as a universal no-op for any runtime call.
      const namedExports = Object.values(SDK_NAMED_EXPORTS)
        .flat()
        .map((name) => `export { _s as ${name} }`)
        .join('\n')
      return [
        'const _s = function() {}',
        'export default _s',
        namedExports,
      ].join('\n')
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
        enabled: false,           // disable SW in dev — navigateFallback causes 404 for index.html
      },
      // Precache all static assets emitted by the build.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Don't precache highlight.js language chunks — they're huge and lazily loaded.
        globIgnores: ['**/highlight.js/**'],
        // navigateFallback must be explicitly null — VitePWA defaults to 'index.html'
        // which causes Workbox to throw "non-precached-url" because adapter-static
        // writes index.html after Vite build, so it never appears in the precache
        // manifest. SPA routing is handled by the hosting layer (adapter-static
        // sets fallback: 'index.html' in its own config).
        navigateFallback: null,
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
