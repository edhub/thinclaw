# ThinClaw

A lightweight AI chat app that runs entirely in your browser.  
No server. No installation. No data leaves your device.

---

## Features

- **Multi-conversation management** — create, switch, rename, and delete conversations
- **Streaming responses** — real-time token streaming via Vercel AI SDK
- **Markdown rendering** — full Markdown support with syntax-highlighted code blocks
- **Local storage only** — conversations stored in IndexedDB; API key in localStorage
- **Dark / light / system theme**
- **Model picker** — GPT-4o, GPT-4o Mini, GPT-4 Turbo, GPT-3.5 Turbo
- **Custom system prompt**

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ or [Bun](https://bun.sh/)
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

Output is in `build/` — a directory of plain static files.

### Preview Build Locally

```bash
pnpm preview
```

---

## Deployment

ThinClaw builds to a static site. Serve the `build/` directory with any static host.

**nginx example:**

```nginx
server {
    listen 80;
    root /var/www/thinclaw;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**Caddy example:**

```
example.com {
    root * /var/www/thinclaw
    try_files {path} /index.html
    file_server
}
```

> The `try_files` / `file_server` fallback to `index.html` is required for SPA routing.

---

## Configuration

All configuration is done in the **Settings** panel (gear icon in the sidebar).

| Setting | Description |
|---|---|
| OpenAI API Key | Required. Never sent anywhere except directly to OpenAI. |
| Model | Which model to use for new conversations. |
| Theme | Light, dark, or follow system preference. |
| System Prompt | Default instruction prepended to every conversation. |

Settings are saved in `localStorage` and persist across page reloads.

---

## Privacy

- Your API key is stored in `localStorage` in your browser only.
- Conversations and messages are stored in `IndexedDB` in your browser only.
- No analytics, no telemetry, no external requests except to the OpenAI API.
- Clearing your browser's site data for this origin deletes everything.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | [SvelteKit](https://kit.svelte.dev/) 2 + Svelte 5 |
| Language | TypeScript (strict) |
| AI | [Vercel AI SDK](https://sdk.vercel.ai/) + `@ai-sdk/openai` |
| Storage | [idb](https://github.com/jakearchibald/idb) (IndexedDB wrapper) |
| Styling | [Tailwind CSS](https://tailwindcss.com/) v4 + CSS custom properties |
| Build | [Vite](https://vitejs.dev/) 7 |
| Deploy | `@sveltejs/adapter-static` (pure SPA, `ssr=false`) |

---

## Development Commands

```bash
pnpm dev        # start dev server (http://localhost:5173)
pnpm build      # production build → build/
pnpm preview    # preview production build locally
pnpm check      # TypeScript + Svelte type check
pnpm sync       # regenerate SvelteKit types (.svelte-kit/)
```

---

## Project Structure

```
src/
├── app.css                       # Global styles and CSS design tokens
├── app.html                      # HTML entry point
├── lib/
│   ├── db/index.ts               # IndexedDB: conversations + messages CRUD
│   ├── stores/
│   │   ├── settings.ts           # API key, model, theme (localStorage)
│   │   └── chat.ts               # Conversation state + streaming
│   ├── components/
│   │   ├── Sidebar.svelte        # Conversation list
│   │   ├── ChatMessage.svelte    # Message rendering (Markdown + hljs)
│   │   ├── ChatInput.svelte      # Message input
│   │   └── Settings.svelte       # Settings modal
│   └── utils/
│       ├── markdown.ts           # marked + lazy highlight.js
│       └── nanoid.ts             # Browser-native ID generation
└── routes/
    ├── +layout.ts                # ssr=false, prerender=true
    └── +page.svelte              # Main page
```

---

## Roadmap

- [ ] Additional AI providers (Anthropic, Gemini, Mistral, Ollama)
- [ ] Tool use / function calling
- [ ] File and image attachments
- [ ] Conversation export (JSON / Markdown)
- [ ] Keyboard shortcuts
- [ ] Mobile-responsive layout
- [ ] PWA / offline support

---

## License

MIT
