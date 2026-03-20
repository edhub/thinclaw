# ThinClaw — Agent Guidelines

## Commands

```bash
pnpm dev      # dev server
pnpm build    # static output → build/
pnpm check    # type-check
pnpm format   # prettier
```

---

## Project Structure

```
src/
├── app.css              # Design tokens + light/dark theme
├── lib/
│   ├── agent/           # models, personas, prompts, soul, tools, image, title, convert, payload, compaction
│   ├── fs/              # OPFS abstraction, agent fs tools, session recorder, @mention helpers
│   ├── db/index.ts      # IndexedDB v3: conversations + messages + memories
│   ├── stores/          # chat.ts · settings.ts · memory.ts
│   ├── components/      # Sidebar, ChatMessage, ChatInput, ModelSwitcher, PersonaPicker,
│   │                    # ToolCard, FileTree, FileEditor, SessionViewer, SettingsSoul, SettingsMemory
│   └── utils/           # markdown.ts (marked + hljs lazy-loaded) · nanoid.ts
└── routes/
    ├── +layout.ts       # ssr=false, prerender=true — pure SPA
    ├── +page.svelte     # Main chat UI
    ├── settings/        # API keys, models, appearance, soul, memory
    └── files/           # File browser + editor + session viewer
```

---

## Architecture

**No server.** `adapter-static` → plain HTML/CSS/JS. All AI calls go browser → provider API directly. See `docs/bianxie.md` for provider/endpoint details.

**Storage:**

| Data | Location |
|---|---|
| Settings, Soul | `localStorage` — `thinclaw:settings`, `thinclaw:soul` |
| Conversations, Messages, Memories | IndexedDB v3 — DB: `thinclaw` |
| OPFS workspace files | `workspace/` (persistent) |
| OPFS tmp + session snapshots | `tmp/` · `sessions/{convId}.jsonl` (7-day TTL) |

**Agent loop:** `@mariozechner/pi-agent-core` runs entirely in the browser. System prompt order: soul → persona (if any) → custom instructions (if any) → memories (if any). Auto-compaction triggers when context exceeds `contextWindow - reserveTokens`.

**@mention:** type `@` in `ChatInput` to inject `<file-context path="...">` blocks from OPFS workspace.

**Memory:** Single-tier. `memory_save` persists stable user identity facts; injected every turn. `memory_delete` removes by ID.

---

## Hard Constraints

- **No server routes** (`+server.ts`). The app is purely static.
- **No Node.js-only deps.** Browser ESM only (no `fs`, `path`, `process`).
- **Svelte 5 runes** (`$state`, `$derived`, `$effect`, `$props`). No legacy `$:` or `export let`.
- **No hardcoded hex colors** in component `<style>`. Use `var(--token)` from `app.css`.
- **Never commit real API keys.**
- **DB schema changes:** bump `openDB` version + add `upgrade` branch. Document in `db/index.ts` header.
- **`highlight.js` is lazy-loaded** — preserve this pattern for other large optional libs.
- **Use Tailwind CSS** as priority.

---

## Design Tokens

`--accent` · `--surface-main` · `--surface-sidebar` · `--surface-elevated` · `--surface-hover` · `--surface-active` · `--surface-input` · `--text-primary` · `--text-secondary` · `--text-muted` · `--border` · `--code-bg` · `--error` · `--error-bg`
