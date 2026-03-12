# ThinClaw — Agent Guidelines

## Project Overview

ThinClaw is a pure-browser AI chat app. No server, no install, no data leaves your device.
It is a deliberate "thin" cut of [OpenClaw](https://github.com/openclaw/openclaw):
all messaging channels, gateway daemon, and Node.js infrastructure are removed.
What remains: a single-page SvelteKit app that talks directly to AI APIs from the browser.

- **Repo:** `~/dev/web/thinclaw` (local only for now)
- **Stack:** SvelteKit 2 + Svelte 5 + TypeScript, `@mariozechner/pi-ai` + `pi-agent-core`, IndexedDB (idb), Tailwind CSS v4
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
│   ├── agent/
│   │   ├── compaction.ts # Auto-compaction for long conversations (CJK-aware)
│   │   ├── models.ts     # Model definitions (Anthropic, Gemini via bianxie proxy)
│   │   ├── prompts.ts    # System prompt builder (soul + memory + custom instructions)
│   │   ├── soul.ts       # AI's persistent identity (localStorage, self-evolving)
│   │   └── tools.ts      # Browser-safe tools (calculate, datetime, soul_*, memory_*)
│   ├── db/
│   │   └── index.ts      # IndexedDB schema v3 and CRUD (conversations + messages + memories)
│   ├── stores/
│   │   ├── settings.ts   # API key, model, theme, system prompt (localStorage)
│   │   ├── chat.ts       # Conversation state, Agent lifecycle, streaming, auto-title
│   │   └── memory.ts     # Reactive memory store (wraps IndexedDB memories table)
│   ├── components/
│   │   ├── Sidebar.svelte      # Conversation list (new/select/rename/delete)
│   │   ├── ChatMessage.svelte  # Message bubble (user text, assistant Markdown, tool calls/results)
│   │   ├── ChatInput.svelte    # Textarea input (Enter = send, Shift+Enter = newline)
│   │   └── Settings.svelte     # Modal: General / Soul / Memory tabs
│   └── utils/
│       ├── markdown.ts   # marked + highlight.js (hljs lazy-loaded on first code block)
│       └── nanoid.ts     # Browser-native random ID (crypto.getRandomValues)
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

### AI SDK
The project uses `@mariozechner/pi-ai` for LLM calls and `@mariozechner/pi-agent-core`
for the agent loop (tool calling, streaming, message management). Both packages are
**browser-compatible** — they do not depend on Node.js APIs (`fs`, `path`, `process`, etc.).

There is no `/api/chat` server route. The `Agent` class from `pi-agent-core` runs
entirely in the browser, calling provider APIs directly.

### CORS
The current providers (Anthropic, Google Gemini) are accessed through `api.bianxie.ai`,
which supports browser CORS. If adding a provider that blocks browser-origin requests,
add a thin Cloudflare Worker or similar edge proxy — do not add a stateful backend.

### Storage
| Data | Location | Notes |
|---|---|---|
| API key, model, theme, system prompt | `localStorage` (key: `thinclaw:settings`) | Plain JSON, no encryption yet |
| Soul (AI identity) | `localStorage` (key: `thinclaw:soul`) | Markdown, self-editable by AI |
| Conversations + messages | IndexedDB (DB: `thinclaw`, version 3) | Persists across sessions |
| Memories | IndexedDB (DB: `thinclaw`, version 3) | Cross-conversation persistent facts |

### Svelte 5 runes
This project uses Svelte 5 rune syntax (`$state`, `$derived`, `$effect`, `$props`).
Do **not** use the legacy `$:` reactive syntax or `export let` in new components.

### System prompt assembly
The system prompt is built from three layers before every message
(see `src/lib/agent/prompts.ts`):
1. **Soul** — AI identity (editable by the AI via `soul_update` tool)
2. **Memory** — persistent facts from IndexedDB (managed via `memory_*` tools)
3. **Custom instructions** — user-provided extra notes from Settings

### Auto-compaction
When context tokens exceed `(contextWindow - reserveTokens)`, old messages are
summarized by the LLM and replaced with a `CompactionSummaryMessage`. Token
estimation is CJK-aware (see `estimateStringTokens` in `compaction.ts`).

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

1. Install the provider package (must be browser-compatible): `pnpm add <package>`
2. Add model entries to `MODELS` in `src/lib/agent/models.ts`
3. In `src/lib/stores/chat.ts`, the `Agent` picks up the model's `api` and `provider`
   fields automatically — no special-casing needed if the model definition is complete.
4. If the provider blocks browser CORS, document the workaround in `docs/providers.md`.

---

## Roadmap (not yet implemented)

- [ ] Multi-provider support (OpenAI, Mistral, local Ollama)
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
- `@mariozechner/pi-ai` and `@mariozechner/pi-agent-core` are confirmed browser-compatible.
- When adding dependencies, verify they work in browser ESM (no `process`, `fs`, `path`, etc.).
- `highlight.js` is lazy-loaded to keep initial bundle small — preserve this pattern for
  other large optional libraries.
- The `build/` directory is gitignored. Never commit build artifacts.
- When modifying the DB schema, bump the `openDB` version number and add a new `upgrade` branch.
