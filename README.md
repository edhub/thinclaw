# ThinClaw

A lightweight AI chat app that runs entirely in your browser.
No server. No installation. No data leaves your device.

---

## Features

- **Multi-provider AI** — Claude (Anthropic), Gemini (Google), GPT (OpenAI) via proxy APIs
- **Agent with tools** — JS sandbox (`run_js`), persistent memory, OPFS file system
- **Streaming responses** — real-time token streaming with thinking block support
- **Markdown rendering** — full Markdown with syntax-highlighted code blocks (lazy-loaded hljs)
- **Personas** — built-in conversational roles (thinking partner, prompt explorer, etc.)
- **File workspace** — OPFS-backed persistent file system with read/write/edit/search
- **Image generation** — via Gemini image model (optional, per-conversation toggle)
- **@mention file injection** — type `@` in chat to attach workspace files as context
- **Local-only storage** — conversations in IndexedDB, settings in localStorage, files in OPFS
- **Dark / light / system theme**
- **Auto-titling** — AI-generated conversation titles after a few rounds

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) (`npm i -g pnpm`)

### Development

```bash
git clone <repo>
cd thinclaw
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

### Production Build

```bash
pnpm build
```

Output is in `build/` — a directory of plain static files. See [docs/deployment.md](docs/deployment.md) for hosting guides (nginx, Caddy, Cloudflare Pages, Docker).

---

## Configuration

All configuration is done in the **Settings** page (gear icon in the sidebar).

| Setting | Description |
|---|---|
| Provider API Keys | One key per provider (laozhang.ai, bianxie.ai). A single key can access multiple models. |
| Model Selection | Choose default and utility (auto-title) models from enabled providers. |
| Model Toggles | Enable/disable individual models per provider. |
| Theme | Light, dark, or follow system preference. |
| Custom Instructions | Extra text appended to the system prompt for all conversations. |
| Soul | The AI's persistent identity — editable by you or the AI itself. |
| Memory | Persistent facts about you, saved by the AI across conversations. |

---

## Privacy

- API keys are stored in `localStorage` in your browser only.
- Conversations, messages, and memories are stored in `IndexedDB` in your browser only.
- Workspace files live in the Origin Private File System (OPFS) — never uploaded.
- No analytics, no telemetry, no external requests except to the AI proxy APIs.
- Clearing your browser's site data for this origin deletes everything.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | [SvelteKit](https://kit.svelte.dev/) 2 + Svelte 5 (runes) |
| Language | TypeScript (strict) |
| AI | [`@mariozechner/pi-ai`](https://github.com/nicolecomputer/pi-ai) + `@mariozechner/pi-agent-core` |
| Storage | [idb](https://github.com/jakearchibald/idb) (IndexedDB) + OPFS |
| Styling | [Tailwind CSS](https://tailwindcss.com/) v4 + CSS custom properties |
| Build | [Vite](https://vitejs.dev/) 7 |
| Deploy | `@sveltejs/adapter-static` (pure SPA, `ssr=false`) |

---

## Commands

```bash
pnpm dev        # start dev server (http://localhost:5173)
pnpm build      # production build → build/
pnpm preview    # preview production build locally
pnpm check      # TypeScript + Svelte type check
pnpm format     # Prettier format
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
│   │   ├── prompts.ts             # buildSystemPrompt → SystemPromptParts
│   │   ├── soul.ts                # AI identity (localStorage, self-editable via soul_update)
│   │   ├── tools.ts               # Agent tools: run_js (JS sandbox + OPFS fs), memory_save, memory_delete
│   │   ├── image.ts               # Image generation tool (Gemini, optional per conversation)
│   │   ├── title.ts               # AI auto-title generation
│   │   └── payload.ts             # onPayload: captures outgoing LLM request payloads for SessionViewer
│   ├── fs/
│   │   ├── opfs.ts                # OPFS abstraction: readFile/writeFile/editFile/listDir/etc.
│   │   ├── session-recorder.ts    # OPFS sessions/{convId}.jsonl after each agent_end
│   │   └── mention.ts             # @mention helpers: listWorkspaceFiles + fuzzyFilter
│   ├── db/
│   │   └── index.ts               # IndexedDB v3: conversations + messages + memories
│   ├── stores/
│   │   ├── chat.ts                # Conversation state, Agent lifecycle, streaming
│   │   ├── settings.ts            # apiKeys, model, theme, systemPrompt (localStorage)
│   │   └── memory.ts              # Reactive memory store (wraps IndexedDB memories table)
│   ├── components/
│   │   ├── Sidebar.svelte         # Conversation list: new / select / rename / delete
│   │   ├── ChatMessage.svelte     # Message bubble: Markdown, tool calls/results, thinking
│   │   ├── ChatInput.svelte       # Textarea + image attach + file upload + @mention
│   │   ├── ModelSwitcher.svelte   # Inline model picker (top-right of chat area)
│   │   ├── PersonaPicker.svelte   # Persona selector (before first message)
│   │   ├── FilePicker.svelte      # @mention dropdown list
│   │   ├── FileContextCard.svelte # File chip preview card
│   │   ├── ToolCard.svelte        # Tool call/result rendering
│   │   ├── FileTree.svelte        # File browser tree component
│   │   ├── FileEditor.svelte      # Markdown file editor
│   │   ├── SessionViewer.svelte   # Session JSONL viewer
│   │   ├── SettingsSoul.svelte    # Soul editor section
│   │   └── SettingsMemory.svelte  # Memory list section
│   └── utils/
│       ├── markdown.ts            # marked + highlight.js (hljs lazy-loaded)
│       └── nanoid.ts              # crypto.getRandomValues ID generator
└── routes/
    ├── +layout.ts                 # ssr=false, prerender=true — pure SPA
    ├── +layout.svelte             # imports app.css
    ├── +page.svelte               # Main chat UI: Sidebar + chat thread
    ├── settings/
    │   └── +page.svelte           # Settings page: providers, models, appearance, soul, memory
    └── files/
        └── +page.svelte           # File browser: workspace/tmp tree + editor + SessionViewer
```

---

## Documentation

- [Deployment Guide](docs/deployment.md) — nginx, Caddy, Cloudflare Pages, Docker
- [Provider Details](docs/providers.md) — proxy APIs, endpoints, per-provider notes
- [Caching](docs/caching-and-compaction.md) — prompt caching strategy, thinking blocks, provider notes
- [Message Types](docs/message-types.md) — all message types, lifecycle, persistence
- [Anthropic Prompt Caching Reference](docs/anthropic-prompt-caching-reference.md) — upstream Anthropic docs, kept for offline reference

---

## License

MIT
