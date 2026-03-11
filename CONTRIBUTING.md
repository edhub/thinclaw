# Contributing to ThinClaw

Thanks for your interest. ThinClaw is intentionally small and focused.
Before opening a PR, please read the design constraints below.

---

## Hard Constraints

These are not negotiable:

1. **No server routes.** Do not add `+server.ts` files. The app must remain a pure static SPA.
2. **No Node.js-only dependencies.** Every package must work in browser ESM.
   Check for `process`, `fs`, `path`, `os`, `child_process` usage before adding a dep.
3. **No analytics or telemetry.** No third-party scripts that phone home.
4. **API keys stay in the browser.** Never proxy keys through a server you control.

---

## What Belongs Here

- Bug fixes in existing features
- UI/UX improvements to the chat interface
- Additional AI provider integrations (see [Adding a Provider](#adding-a-provider))
- Accessibility improvements
- Performance improvements (bundle size, render latency)
- Documentation fixes

## What Does Not Belong Here

- Messaging channel integrations (Telegram, Discord, etc.) — use [OpenClaw](https://github.com/openclaw/openclaw) instead
- Browser automation / computer-use features
- Multi-user / shared session features
- Anything requiring a stateful backend

---

## Development Setup

```bash
git clone <repo>
cd thinclaw
pnpm install
pnpm dev
```

Run `pnpm check` before submitting. Fix all TypeScript and Svelte errors.

---

## Code Style

- TypeScript strict mode. No `any`. No `@ts-ignore`.
- Svelte 5 rune syntax (`$state`, `$derived`, `$effect`, `$props`) in `.svelte` files.
- No `$:` reactive statements or `export let` in new code.
- Colors via CSS custom properties only — no hardcoded hex values in component `<style>`.
- Components under ~200 LOC. Split when it helps clarity.

---

## Adding a Provider

1. `pnpm add @ai-sdk/<provider-name>`
2. Add model IDs + labels to `MODELS` in `src/lib/stores/settings.ts`
3. Update `sendMessage` in `src/lib/stores/chat.ts` to branch on provider
4. Update `src/lib/components/Settings.svelte` if a provider needs extra config (e.g. base URL)
5. Add a brief entry to `docs/providers.md` noting any CORS requirements

If a provider blocks browser-origin requests, document the Cloudflare Worker workaround
in `docs/providers.md`. Do not add a stateful server to solve CORS.

---

## Commit Messages

Use the format: `<scope>: <what changed>`

Examples:
- `chat: fix streaming abort on navigation`
- `db: add message search index`
- `settings: add Anthropic provider`
- `docs: update deployment guide`

---

## DB Schema Changes

If you change the IndexedDB schema:
1. Bump the version number in `openDB(...)` in `src/lib/db/index.ts`
2. Add a new `upgrade` case for the new version (do not modify existing cases)
3. Document the migration in `docs/db-migrations.md`

---

## Bundle Size

Keep an eye on `pnpm build` output. The initial JS bundle (before lazy chunks) should
stay under ~150 KB gzipped. Large libraries must be lazy-loaded (see `markdown.ts` for
the pattern used for highlight.js).
