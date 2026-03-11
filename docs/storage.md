# Storage Architecture

ThinClaw stores all data locally in the browser. Nothing is sent to any server except AI API calls.

---

## localStorage

**Key:** `thinclaw:settings`

Stores user preferences as a JSON object:

```ts
interface Settings {
  apiKey: string;     // OpenAI API key
  model: string;      // e.g. "gpt-4o"
  theme: 'light' | 'dark' | 'system';
  systemPrompt: string;
}
```

Cleared when the user clears site data or calls `localStorage.clear()`.

---

## IndexedDB

**Database name:** `thinclaw`  
**Current version:** `1`  
**Implementation:** `src/lib/db/index.ts` (uses [idb](https://github.com/jakearchibald/idb))

### Object stores

#### `conversations`

| Field | Type | Description |
|---|---|---|
| `id` | `string` (key) | nanoid, e.g. `"abc123xyz"` |
| `title` | `string` | Auto-set from first message (60 chars), editable |
| `model` | `string` | Model ID at conversation creation time |
| `createdAt` | `number` | Unix ms timestamp |
| `updatedAt` | `number` | Unix ms timestamp, updated on each new message |

Indexes: `by-updatedAt` (for sorting newest-first in sidebar)

#### `messages`

| Field | Type | Description |
|---|---|---|
| `id` | `string` (key) | nanoid |
| `conversationId` | `string` | FK → conversations.id |
| `role` | `'user' \| 'assistant' \| 'system'` | Message role |
| `content` | `string` | Full message text |
| `createdAt` | `number` | Unix ms timestamp |

Indexes: `by-conversationId` (for loading a conversation's messages), `by-createdAt`

---

## Data Lifecycle

- **New conversation:** record created in `conversations` store when user sends first message (or clicks "Start a conversation")
- **New message:** user message persisted immediately; assistant message persisted after streaming completes
- **Delete conversation:** removes the `conversations` record and all associated `messages` in a single transaction
- **Clear all:** user must clear browser site data manually (no in-app nuke button yet)

---

## Schema Migration

When the schema changes, bump the version in `openDB` and add a new `upgrade` branch:

```ts
openDB<ThinClawDB>('thinclaw', 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      // original schema setup ...
    }
    if (oldVersion < 2) {
      // new migration: e.g. add an index
      db.createObjectStore('newStore', { keyPath: 'id' });
    }
  },
});
```

Document each migration in `docs/db-migrations.md`.

---

## Privacy Notes

- IndexedDB data is scoped to the origin (`scheme://host:port`). Other origins cannot read it.
- The data is **not** encrypted at rest. The OS and anyone with filesystem access to the browser profile can read it.
- Future: consider using Web Crypto to encrypt message content with a key derived from the API key.
