import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

/**
 * Shared replacement table for the pi-ai dynamic import fix.
 * Applied both during esbuild dep pre-bundling (dev) and Rollup build (prod).
 */
const PI_AI_REPLACEMENTS: Array<[RegExp, string]> = [
  [/dynamicImport\(ANTHROPIC_PROVIDER_SPECIFIER\)/g,               'import("@mariozechner/pi-ai/anthropic")'],
  [/dynamicImport\(AZURE_OPENAI_RESPONSES_PROVIDER_SPECIFIER\)/g,  'import("@mariozechner/pi-ai/azure-openai-responses")'],
  [/dynamicImport\(GOOGLE_PROVIDER_SPECIFIER\)/g,                  'import("@mariozechner/pi-ai/google")'],
  [/dynamicImport\(GOOGLE_GEMINI_CLI_PROVIDER_SPECIFIER\)/g,       'import("@mariozechner/pi-ai/google-gemini-cli")'],
  [/dynamicImport\(GOOGLE_VERTEX_PROVIDER_SPECIFIER\)/g,           'import("@mariozechner/pi-ai/google-vertex")'],
  [/dynamicImport\(MISTRAL_PROVIDER_SPECIFIER\)/g,                 'import("@mariozechner/pi-ai/mistral")'],
  [/dynamicImport\(OPENAI_CODEX_RESPONSES_PROVIDER_SPECIFIER\)/g,  'import("@mariozechner/pi-ai/openai-codex-responses")'],
  [/dynamicImport\(OPENAI_COMPLETIONS_PROVIDER_SPECIFIER\)/g,      'import("@mariozechner/pi-ai/openai-completions")'],
  [/dynamicImport\(OPENAI_RESPONSES_PROVIDER_SPECIFIER\)/g,        'import("@mariozechner/pi-ai/openai-responses")'],
]

function applyPiAiReplacements(code: string): string {
  return PI_AI_REPLACEMENTS.reduce((c, [re, s]) => c.replace(re, s), code)
}

/**
 * Fix for @mariozechner/pi-ai register-builtins.js dynamic import pattern.
 *
 * The library deliberately obscures its dynamic imports from bundlers:
 *   const dynamicImport = (specifier) => import(specifier);
 *   dynamicImport(ANTHROPIC_PROVIDER_SPECIFIER)  // "./anthropic.js"
 *
 * Vite/Rollup cannot statically analyse `import(variable)`, so the call is
 * left verbatim in the output bundle.  At runtime the browser resolves
 * `"./anthropic.js"` relative to that bundle file → path that doesn't exist → 404.
 *
 * Two-pronged fix:
 *   - Rollup (prod build): Vite `transform` hook rewrites the calls before
 *     Rollup analyses them, so each provider is emitted as a proper hashed chunk.
 *   - esbuild (dev pre-bundling): an esbuild `onLoad` plugin reads and rewrites
 *     the file during dep optimisation so CJS→ESM conversion and the rewrite
 *     both happen inside the same esbuild pass. This avoids the CJS named-import
 *     breakage that occurs when the package is excluded from pre-bundling.
 */
function fixPiAiDynamicImports(): Plugin {
  return {
    name: 'fix-pi-ai-dynamic-imports',
    transform(code: string, id: string) {
      if (!id.includes('register-builtins')) return null
      return applyPiAiReplacements(code)
    },
  }
}

export default defineConfig({
  plugins: [
    fixPiAiDynamicImports(),
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
  // During esbuild dep pre-bundling (dev mode), Vite plugin transform hooks do
  // not run. Instead we inject an esbuild onLoad plugin that reads and rewrites
  // register-builtins.js inside the same esbuild pass, so CJS→ESM conversion
  // and the dynamic-import fix both happen correctly.
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: 'fix-pi-ai-dynamic-imports-esbuild',
          setup(build) {
            build.onLoad({ filter: /register-builtins\.js$/ }, (args) => {
              const code = readFileSync(args.path, 'utf-8')
              return { contents: applyPiAiReplacements(code), loader: 'js' }
            })
          },
        },
      ],
    },
  },
})
