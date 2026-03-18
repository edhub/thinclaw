# ThinClaw — Agent Guidelines

## Commands

```bash
pnpm dev          # dev server
pnpm build        # static output → build/
pnpm check        # type-check
pnpm format       # prettier
```

---

## Project Structure

```
src/
├── app.css                        # Design tokens (CSS custom properties), light/dark theme
├── lib/
│   ├── agent/
│   │   ├── models.ts              # MODELS array + getModelByKey + DEFAULT_*_MODEL_KEY
│   │   ├── personas.ts            # BUILTIN_PERSONAS + getPersonaById
│   │   ├── prompts.ts             # buildSystemPrompt → SystemPromptParts (soul+persona+custom+memory)
│   │   ├── soul.ts                # AI identity (localStorage, self-editable via soul_update tool)
│   │   ├── tools.ts               # Agent tools: calculate, datetime, soul_*, memory_save, memory_delete
│   │   ├── image.ts               # Image generation tool (Gemini, optional per conversation)
│   │   ├── title.ts               # AI auto-title generation for conversations
│   │   ├── convert.ts             # convertToLlm: AgentMessage[] → Message[] (redacted thinking, error filtering)
│   │   ├── payload.ts             # onPayload hook: provider-specific system prompt splitting + cache_control
│   │   └── compaction.ts          # Auto-compaction: token estimation + LLM summarisation
│   ├── fs/
│   │   ├── opfs.ts                # OPFS abstraction: readFile/writeFile/editFile/listDir/
│   │   │                          #   searchFiles/statEntry/moveEntry/deleteEntry/outlineFile
│   │   │                          #   Layout: workspace/ (persistent) + tmp/ (7-day TTL)
│   │   ├── tools.ts               # Agent tools: fs_read/write/edit/list/search/outline/stat/move/delete
│   │   ├── session-recorder.ts    # Writes OPFS sessions/{convId}.jsonl after each agent_end
│   │   └── mention.ts             # @mention helpers: listWorkspaceFiles + fuzzyFilter + getFilePreview
│   ├── db/
│   │   └── index.ts               # IndexedDB v3: conversations + messages + memories (idb)
│   ├── stores/
│   │   ├── chat.ts                # Conversation state, Agent lifecycle, streaming, compaction, auto-title
│   │   ├── settings.ts            # apiKeys, model, theme, systemPrompt (localStorage)
│   │   └── memory.ts              # Reactive memory store (wraps IndexedDB memories table)
│   ├── components/
│   │   ├── Sidebar.svelte         # Conversation list: new / select / rename / delete
│   │   ├── ChatMessage.svelte     # Message bubble: user text, assistant Markdown, tool calls/results
│   │   ├── ChatInput.svelte       # Textarea + image attach + text file upload + @mention dropdown
│   │   ├── ModelSwitcher.svelte   # Inline model picker (top-right of chat area)
│   │   ├── PersonaPicker.svelte   # Persona selector shown before first message
│   │   ├── FilePicker.svelte      # @mention dropdown list
│   │   ├── FileContextCard.svelte # File chip preview card
│   │   ├── ToolCard.svelte        # Tool call/result card (expandable)
│   │   ├── FileTree.svelte        # File browser tree component
│   │   ├── FileEditor.svelte      # Markdown file editor
│   │   ├── SessionViewer.svelte   # Session JSONL viewer / debugger
│   │   ├── SettingsSoul.svelte    # Soul editor section (used by settings page)
│   │   └── SettingsMemory.svelte  # Memory list section (used by settings page)
│   └── utils/
│       ├── markdown.ts            # marked + highlight.js (hljs lazy-loaded on first code block)
│       └── nanoid.ts              # crypto.getRandomValues ID generator
└── routes/
    ├── +layout.ts                 # ssr=false, prerender=true — pure SPA
    ├── +layout.svelte             # imports app.css
    ├── +page.svelte               # Main chat UI: Sidebar + chat thread + PersonaPicker
    ├── settings/
    │   └── +page.svelte           # Settings page: providers, models, appearance, soul, memory
    └── files/
        └── +page.svelte           # File browser: workspace/tmp tree + Markdown editor + SessionViewer
```

---

## Architecture

**No server.** `adapter-static` → plain HTML/CSS/JS. All AI calls go browser → proxy API directly. See `docs/bianxie.md` for provider/endpoint details.

**Storage:**

| Data | Location | Key / DB |
|---|---|---|
| Settings, Soul | `localStorage` | `thinclaw:settings`, `thinclaw:soul` |
| Conversations, Messages, Memories | IndexedDB v3 | DB: `thinclaw` |
| OPFS workspace files | Origin Private File System | `workspace/` |
| OPFS tmp files (7-day TTL) | Origin Private File System | `tmp/` |
| Session snapshots (7-day TTL) | Origin Private File System | `sessions/{convId}.jsonl` |

**Agent loop:** `@mariozechner/pi-agent-core` `Agent` runs entirely in the browser. System prompt is rebuilt before every message as an ordered sequence: soul + How-You-Operate → active persona (if any) → custom instructions (if any) → memories (if any). Auto-compaction triggers when context exceeds `contextWindow - reserveTokens`.

**Personas** are selected in `PersonaPicker` before the first message and locked afterwards. Stored as `personaId` on the `Conversation` record.

**@mention** in `ChatInput`: type `@` to open a file picker, selected files are injected as `<file-context path="...">` blocks prepended to the message.

**Memory system:** Single-tier. Only stable identity facts about the user (name, language, key long-term preferences) are persisted via `memory_save`. Memories are injected as the last system prompt block on every turn. `memory_delete` removes stale entries by ID. No `memory_recall` — there is no general/situational tier.

---

## Hard Constraints

- **No server routes** (`+server.ts`). The app is purely static.
- **No Node.js-only deps.** All packages must be browser ESM-compatible (no `fs`, `path`, `process`).
- **Svelte 5 runes** (`$state`, `$derived`, `$effect`, `$props`). No legacy `$:` or `export let`.
- **No hardcoded hex colors** in component `<style>`. Use `var(--token)` from `app.css`.
- **Never commit real API keys.**
- **DB schema changes:** bump `openDB` version and add a new `upgrade` branch. Document in `db/index.ts` header.
- **`highlight.js` is lazy-loaded** — preserve this pattern for other large optional libs.

---

## Adding a Model

1. Add an entry to `MODELS` in `src/lib/agent/models.ts`.
2. Choose `api` based on provider: `'anthropic-messages'` / `'google-generative-ai'` / `'openai-completions'` — see `docs/bianxie.md`.
3. Set `reasoning: true` for thinking models (agent will use `thinkingLevel: 'medium'`).
4. No other changes needed.

---

## Design Tokens (app.css)

```
--accent              Primary brand color
--surface-main        Page background
--surface-sidebar     Sidebar background
--surface-elevated    Cards / elevated surfaces
--surface-hover       Hover state
--surface-active      Active / selected item
--surface-input       Input field background
--text-primary        Main text
--text-secondary      Subdued text
--text-muted          Placeholder / hint
--border              Dividers, input borders
--code-bg             Code block background (always dark)
--error / --error-bg  Error states
```
