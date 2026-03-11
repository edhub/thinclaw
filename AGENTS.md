# ThinClaw — Agent Guidelines

## Project Overview

ThinClaw is a pure-browser AI chat app. No server, no install, no data leaves your device.
It is a deliberate "thin" cut of [OpenClaw](https://github.com/openclaw/openclaw):
all messaging channels, gateway daemon, and Node.js infrastructure are removed.
What remains: a single-page SvelteKit app that talks directly to AI APIs from the browser.

- **Repo:** `~/dev/web/thinclaw` (local only for now)
- **Stack:** SvelteKit 2 + Svelte 5 + TypeScript, Vercel AI SDK, IndexedDB (idb), Tailwind CSS v4
- **Deploy target:** any static file host (nginx, Caddy, GitHub Pages, Cloudflare Pages, etc.)

---

## Build, Dev, and Test Commands

- Install deps: `pnpm install`
- Dev server: `pnpm dev`
- Production build: `pnpm build` → output in `build/`
- Preview build: `pnpm preview`
- Type-check: `pnpm check`
- Sync SvelteKit types: `pnpm sync`

No test framework is set up yet. Add Vitest + `@vitest/browser` when writing logic tests.

---

## Project Structure

```
src/
├── app.css               # Global styles, CSS design tokens, dark/light theme vars
├── app.html              # HTML shell
├── lib/
│   ├── db/
│   │   └── index.ts      # IndexedDB schema and CRUD (conversations + messages)
│   ├── stores/
│   │   ├── settings.ts   # API key, model, theme, system prompt (localStorage)
│   │   └── chat.ts       # Conversation state, message streaming, auto-title
│   ├── components/
│   │   ├── Sidebar.svelte      # Conversation list (new/select/rename/delete)
│   │   ├── ChatMessage.svelte  # Message bubble (user plain text, assistant Markdown)
│   │   ├── ChatInput.svelte    # Textarea input (Enter = send, Shift+Enter = newline)
│   │   └── Settings.svelte     # Modal: API key, model, theme, system prompt
│   └── utils/
│       ├── markdown.ts   # marked + highlight.js (hljs lazy-loaded on first code block)
│       └── nanoid.ts     # Browser-native random ID (no external dependency)
└── routes/
    ├── +layout.ts        # ssr=false, prerender=true — pure SPA
    ├── +layout.svelte    # Imports app.css
    └── +page.svelte      # App shell: Sidebar + chat area + Settings modal
```

---

## Architecture Decisions

### No server
`adapter-static` produces plain HTML/CSS/JS. There are no SvelteKit server routes.
AI API calls go directly from the browser to the provider endpoint.

### CORS
OpenAI supports browser CORS. Other providers may not. If adding a provider that blocks
browser-origin requests, add a thin Cloudflare Worker or similar edge proxy — do not add
a stateful backend.

### Storage
| Data | Location | Notes |
|---|---|---|
| API key, model, theme, system prompt | `localStorage` (key: `thinclaw:settings`) | Plain JSON, no encryption yet |
| Conversations + messages | IndexedDB (DB: `thinclaw`, version 1) | Persists across sessions |

### Svelte 5 runes
This project uses Svelte 5 rune syntax (`$state`, `$derived`, `$effect`, `$props`).
Do **not** use the legacy `$:` reactive syntax or `export let` in new components.

### Vercel AI SDK usage
`streamText` from `ai` is called directly in the browser (`src/lib/stores/chat.ts`).
There is no `/api/chat` server route. The `useChat` hook is intentionally not used.

---

## Coding Style

- Language: TypeScript strict mode. No `any`.
- Formatting: no formatter configured yet; follow the surrounding style.
- Component files: one component per `.svelte` file, co-located CSS in `<style>`.
- Stores: use Svelte 5 runes inside `.svelte` files; use `writable`/`derived` in `.ts` store files.
- CSS: use CSS custom properties (`var(--token)`) from `app.css` for all colors. No hardcoded hex values in component `<style>` blocks.
- Keep components under ~200 LOC. Split into sub-components when needed.
- Add brief comments for non-obvious logic.

---

## Design Tokens

All color/surface tokens are defined in `src/app.css` under `:root` (light) and
`[data-theme='dark']` / `@media (prefers-color-scheme: dark)`.

Key tokens:
```
--accent            Primary brand color (indigo-ish)
--surface-main      Page background
--surface-sidebar   Sidebar background
--surface-elevated  Cards, elevated surfaces
--surface-hover     Hover state background
--surface-active    Active/selected item background
--surface-input     Input field background
--text-primary      Main text
--text-secondary    Subdued text
--text-muted        Placeholder / hint text
--border            Dividers and input borders
--code-bg           Code block background (always dark)
--error / --error-bg Error states
```

---

## Adding a New AI Provider

1. Install the provider package: `pnpm add @ai-sdk/<provider>`
2. Add model entries to `MODELS` in `src/lib/stores/settings.ts`
3. In `src/lib/stores/chat.ts`, update `sendMessage` to instantiate the correct provider
   based on `model` prefix or a separate `provider` setting field.
4. If the provider blocks browser CORS, document the workaround in `docs/providers.md`.

---

## Roadmap (not yet implemented)

- [ ] Multi-provider support (Anthropic, Gemini, Mistral, local Ollama)
- [ ] Tool use / function calling
- [ ] File / image attachment upload
- [ ] Conversation export (JSON / Markdown)
- [ ] Keyboard shortcuts
- [ ] Mobile-responsive layout
- [ ] PWA / offline support
- [ ] CORS proxy helper (Cloudflare Worker template)
- [ ] Optional end-to-end encryption for stored messages

---

## Agent Notes

- Never commit real API keys. The `apiKey` field in Settings is user-supplied at runtime.
- Do not add server-side routes (`+server.ts`). Keep the app purely static.
- Do not add Node.js-only dependencies. All deps must be browser-compatible.
- When adding dependencies, verify they work in browser ESM (no `process`, `fs`, `path`, etc.).
- `highlight.js` is lazy-loaded to keep initial bundle small — preserve this pattern for
  other large optional libraries.
- The `build/` directory is gitignored. Never commit build artifacts.
- When modifying the DB schema, bump the `openDB` version number and add a new `upgrade` branch.
