import { sveltekit } from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Fix for @mariozechner/pi-ai register-builtins.js dynamic import pattern.
 *
 * The library deliberately obscures its dynamic imports from bundlers:
 *   const dynamicImport = (specifier) => import(specifier);
 *   dynamicImport(ANTHROPIC_PROVIDER_SPECIFIER)  // "./anthropic.js"
 *
 * Vite/Rollup cannot statically analyse `import(variable)`, so the call is
 * left verbatim in the output bundle (currently a nodes/*.js file).  At
 * runtime the browser resolves `"./anthropic.js"` relative to that node
 * file → `_app/immutable/nodes/anthropic.js`, which doesn't exist → 404.
 *
 * This plugin rewrites those calls to use the package's own named exports
 * (e.g. `@mariozechner/pi-ai/anthropic`) so Vite CAN statically trace them,
 * bundles each provider as a proper hashed chunk, and emits the correct
 * relative path in the final output.
 */
function fixPiAiDynamicImports(): Plugin {
  return {
    name: 'fix-pi-ai-dynamic-imports',
    transform(code: string, id: string) {
      if (!id.includes('register-builtins')) return null

      return code
        .replace(
          /dynamicImport\(ANTHROPIC_PROVIDER_SPECIFIER\)/g,
          'import("@mariozechner/pi-ai/anthropic")',
        )
        .replace(
          /dynamicImport\(AZURE_OPENAI_RESPONSES_PROVIDER_SPECIFIER\)/g,
          'import("@mariozechner/pi-ai/azure-openai-responses")',
        )
        .replace(
          /dynamicImport\(GOOGLE_PROVIDER_SPECIFIER\)/g,
          'import("@mariozechner/pi-ai/google")',
        )
        .replace(
          /dynamicImport\(GOOGLE_GEMINI_CLI_PROVIDER_SPECIFIER\)/g,
          'import("@mariozechner/pi-ai/google-gemini-cli")',
        )
        .replace(
          /dynamicImport\(GOOGLE_VERTEX_PROVIDER_SPECIFIER\)/g,
          'import("@mariozechner/pi-ai/google-vertex")',
        )
        .replace(
          /dynamicImport\(MISTRAL_PROVIDER_SPECIFIER\)/g,
          'import("@mariozechner/pi-ai/mistral")',
        )
        .replace(
          /dynamicImport\(OPENAI_CODEX_RESPONSES_PROVIDER_SPECIFIER\)/g,
          'import("@mariozechner/pi-ai/openai-codex-responses")',
        )
        .replace(
          /dynamicImport\(OPENAI_COMPLETIONS_PROVIDER_SPECIFIER\)/g,
          'import("@mariozechner/pi-ai/openai-completions")',
        )
        .replace(
          /dynamicImport\(OPENAI_RESPONSES_PROVIDER_SPECIFIER\)/g,
          'import("@mariozechner/pi-ai/openai-responses")',
        )
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
