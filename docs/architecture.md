# Architecture

ThinClaw is a pure-browser single-page application. This document explains the key
architectural choices and the boundaries they create.

---

## Overview

```
┌─────────────────────────────────────────────────┐
│                  Browser                         │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Svelte   │  │  Svelte  │  │  Vercel AI    │  │
│  │ UI layer │→ │  stores  │→ │  SDK (fetch)  │──┼──→ OpenAI API
│  └──────────┘  └──────────┘  └───────────────┘  │
│                     │                            │
│              ┌──────▼──────┐                     │
│              │  IndexedDB  │  (conversations,    │
│              │  localStorage│   messages,        │
│              └─────────────┘   settings)         │
└─────────────────────────────────────────────────┘
```

There is no backend. The browser talks directly to the AI provider.

---

## Data Flow: Sending a Message

1. User types in `ChatInput.svelte` and presses Enter
2. `+page.svelte` calls `sendMessage(...)` from `src/lib/stores/chat.ts`
3. `chat.ts` persists the user message to IndexedDB
4. `chat.ts` adds an empty assistant message placeholder to the `activeMessages` store
5. `streamText(openai(model), ...)` opens a streaming HTTP request to OpenAI
6. Each token delta updates the placeholder in the Svelte store → reactive UI re-render
7. On stream completion, the full assistant message is persisted to IndexedDB
8. `listConversations()` refreshes the sidebar (updatedAt ordering)

---

## State Management

| Store | Type | Location |
|---|---|---|
| `conversations` | `writable<Conversation[]>` | `stores/chat.ts` |
| `activeConversationId` | `writable<string \| null>` | `stores/chat.ts` |
| `activeMessages` | `writable<Message[]>` | `stores/chat.ts` |
| `isStreaming` | `writable<boolean>` | `stores/chat.ts` |
| `streamError` | `writable<string \| null>` | `stores/chat.ts` |
| `activeConversation` | `derived` | `stores/chat.ts` |
| `settings` | custom writable | `stores/settings.ts` |

All stores are module-level singletons. Components import and subscribe directly.

---

## SPA Routing

SvelteKit's `adapter-static` is used with `ssr: false` and `prerender: true`.
This produces a single `index.html` that handles all routes client-side.

The server must serve `index.html` as the fallback for all paths (see `docs/deployment.md`).

There is currently only one route: `/`. Future routes (e.g. `/settings`, `/conversation/:id`)
would be added under `src/routes/` without needing any server changes.

---

## Bundle Strategy

| Chunk | Contents | Load time |
|---|---|---|
| `start.js` (~0.1 KB) | SvelteKit bootstrap | Immediate |
| `app.js` (~5 KB) | SvelteKit runtime | Immediate |
| `nodes/2.js` (~400 KB) | App code + Svelte + marked + idb + AI SDK | Immediate |
| `BBc-AmEf.js` (~970 KB) | highlight.js | Lazy (first code block render) |

highlight.js is deferred via a dynamic `import('highlight.js')` in `utils/markdown.ts`.
The first render of an assistant message with a code block triggers the load.
Subsequent renders use the cached module.

---

## Security Considerations

- The API key is stored in plaintext in `localStorage`. Anyone with DevTools access can
  read it. This is an accepted trade-off for a local-only app.
- There is no CSRF concern (no server).
- Content from AI responses is rendered as HTML via `{@html ...}` in `ChatMessage.svelte`.
  `marked` produces safe HTML for standard Markdown. If user-controlled content could
  reach the renderer, add DOMPurify sanitization.
- The app makes no requests other than to the configured AI API endpoint.

---

## What Was Deliberately Removed (vs OpenClaw)

ThinClaw is derived from [OpenClaw](https://github.com/openclaw/openclaw) in concept only.
No code is shared. The following OpenClaw capabilities do not exist here by design:

| Removed | Reason |
|---|---|
| Gateway / HTTP server | Requires Node.js, not browser-runnable |
| Messaging channels (Telegram, Discord, etc.) | Require persistent server-side bot processes |
| Browser automation (Playwright / CDP) | Requires Node.js |
| Plugin system | Requires filesystem + dynamic require |
| Config file (`~/.openclaw/config.yaml`) | Replaced by localStorage |
| Session filesystem storage | Replaced by IndexedDB |
| Daemon / process management | Not applicable in browser |
| TLS / cert management | Handled by the static file server |
| iMessage / Signal | Require OS-level access |
