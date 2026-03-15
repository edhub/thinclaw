/**
 * IndexedDB schema v3.
 *
 * v1 → v2: incompatible schema change, dropped and recreated conversations + messages.
 * v2 → v3: added `memories` object store (no data loss).
 *
 * Stores:
 *   conversations  — chat conversation metadata
 *   messages       — AgentMessage rows per conversation
 *   memories       — persistent AI memory entries (global, cross-conversation)
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AgentMessage } from '@mariozechner/pi-agent-core'

export type { AgentMessage }

export interface Conversation {
  id: string
  title: string
  model: string
  personaId?: string      // optional: built-in persona locked in at conversation creation
  imageToolEnabled?: boolean // whether the generate_image tool is active for this conversation
  createdAt: number
  updatedAt: number
}

/** One row per AgentMessage (user / assistant / toolResult) */
export interface StoredMessage {
  id: string // nanoid
  conversationId: string
  seq: number // 0-indexed ordering
  data: AgentMessage
}

/** A persistent memory entry saved by the AI (or the user). */
export interface Memory {
  id: string
  content: string
  /**
   * 'core'    — identity-level facts (name, language, key preferences).
   *             Always injected into every conversation context.
   *             Expected to stay small; user manages quality manually.
   * 'general' — project details, events, situational context.
   *             Not auto-injected; retrieved on demand via memory_recall.
   *             Missing tier (legacy records) is treated as 'general'.
   */
  tier: 'core' | 'general'
  createdAt: number
  updatedAt: number
}

interface ThinClawDB extends DBSchema {
  conversations: {
    key: string
    value: Conversation
    indexes: { 'by-updatedAt': number }
  }
  messages: {
    key: string
    value: StoredMessage
    indexes: { 'by-conversationId': string }
  }
  memories: {
    key: string
    value: Memory
    indexes: { 'by-createdAt': number }
  }
}

let dbPromise: Promise<IDBPDatabase<ThinClawDB>> | null = null

export function getDB(): Promise<IDBPDatabase<ThinClawDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ThinClawDB>('thinclaw', 3, {
      upgrade(db, oldVersion) {
        // v1 → v2: drop and recreate (incompatible schema)
        if (oldVersion < 2) {
          if (db.objectStoreNames.contains('conversations' as never)) {
            db.deleteObjectStore('conversations' as never)
          }
          if (db.objectStoreNames.contains('messages' as never)) {
            db.deleteObjectStore('messages' as never)
          }
        }

        // Always ensure conversations + messages exist (created fresh on v1→v2 or v0→v2)
        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', { keyPath: 'id' })
          convStore.createIndex('by-updatedAt', 'updatedAt')
        }
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' })
          msgStore.createIndex('by-conversationId', 'conversationId')
        }

        // v2 → v3: add memories store (non-destructive)
        if (oldVersion < 3) {
          const memStore = db.createObjectStore('memories', { keyPath: 'id' })
          memStore.createIndex('by-createdAt', 'createdAt')
        }
      },
    })
  }
  return dbPromise
}

// ─── Conversation operations ──────────────────────────────────────────────────

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('conversations', 'by-updatedAt')
  return all.reverse() // newest first
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const db = await getDB()
  await db.put('conversations', conv)
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['conversations', 'messages'], 'readwrite')
  await tx.objectStore('conversations').delete(id)
  const msgIndex = tx.objectStore('messages').index('by-conversationId')
  const keys = await msgIndex.getAllKeys(id)
  await Promise.all(keys.map((k) => tx.objectStore('messages').delete(k)))
  await tx.done
}

// ─── Message operations ───────────────────────────────────────────────────────

export async function getMessages(conversationId: string): Promise<AgentMessage[]> {
  const db = await getDB()
  const rows = await db.getAllFromIndex('messages', 'by-conversationId', conversationId)
  rows.sort((a, b) => a.seq - b.seq)
  return rows.map((r) => r.data)
}

/** Persist an array of AgentMessages (appends after existing, using offset for seq). */
export async function appendMessages(
  conversationId: string,
  messages: AgentMessage[],
  seqOffset: number,
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  for (let i = 0; i < messages.length; i++) {
    const stored: StoredMessage = {
      id: `${conversationId}:${seqOffset + i}`,
      conversationId,
      seq: seqOffset + i,
      data: messages[i],
    }
    tx.objectStore('messages').put(stored)
  }
  await tx.done
}

/**
 * Replace ALL messages for a conversation (used after compaction).
 * Deletes existing rows then inserts the new compacted set.
 */
export async function replaceAllMessages(
  conversationId: string,
  messages: AgentMessage[],
): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('messages', 'readwrite')
  const store = tx.objectStore('messages')
  const keys = await store.index('by-conversationId').getAllKeys(conversationId)
  for (const k of keys) store.delete(k)
  for (let i = 0; i < messages.length; i++) {
    store.put({
      id: `${conversationId}:${i}`,
      conversationId,
      seq: i,
      data: messages[i],
    } satisfies StoredMessage)
  }
  await tx.done
}

// ─── Memory operations ────────────────────────────────────────────────────────

export async function listMemories(): Promise<Memory[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('memories', 'by-createdAt')
  return all.reverse() // newest first
}

export async function saveMemory(mem: Memory): Promise<void> {
  const db = await getDB()
  await db.put('memories', mem)
}

export async function deleteMemory(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('memories', id)
}

/**
 * Simple keyword search over memory content.
 * Splits the query into tokens and tries AND matching first;
 * falls back to OR if no AND results are found.
 *
 * @param query   Space-separated keywords.
 * @param options.tier   Filter by tier. Defaults to 'all'. Legacy records
 *                       without a tier field are treated as 'general'.
 * @param options.limit  Maximum results to return. Defaults to 20.
 */
export async function searchMemories(
  query: string,
  options?: { tier?: 'core' | 'general' | 'all'; limit?: number },
): Promise<Memory[]> {
  const all = await listMemories()
  const tier = options?.tier ?? 'all'
  const limit = options?.limit ?? 20

  // Treat missing tier (legacy records) as 'general'.
  const candidates =
    tier === 'all'
      ? all
      : all.filter((m) => (m.tier ?? 'general') === tier)

  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1)
  if (tokens.length === 0) return candidates.slice(0, limit)

  // AND match first — all tokens must be present.
  let results = candidates.filter((m) => {
    const text = m.content.toLowerCase()
    return tokens.every((t) => text.includes(t))
  })

  // OR fallback — any single token matches.
  if (results.length === 0) {
    results = candidates.filter((m) => {
      const text = m.content.toLowerCase()
      return tokens.some((t) => text.includes(t))
    })
  }

  return results.slice(0, limit)
}
