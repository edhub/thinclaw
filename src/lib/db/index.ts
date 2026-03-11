/**
 * IndexedDB schema v2.
 * Messages now store pi-ai AgentMessage objects directly as JSON.
 * v1 data is dropped on upgrade (incompatible schema).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

export type { AgentMessage };

export interface Conversation {
  id: string;
  title: string;
  model: string;       // Model id
  personaId: string;   // Persona id
  createdAt: number;
  updatedAt: number;
}

/** One row per AgentMessage (user / assistant / toolResult) */
export interface StoredMessage {
  id: string;             // nanoid
  conversationId: string;
  seq: number;            // 0-indexed ordering
  data: AgentMessage;     // full pi-ai message (serialized as JSON)
}

interface ThinClawDB extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { 'by-updatedAt': number };
  };
  messages: {
    key: string;
    value: StoredMessage;
    indexes: { 'by-conversationId': string };
  };
}

let dbPromise: Promise<IDBPDatabase<ThinClawDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<ThinClawDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ThinClawDB>('thinclaw', 2, {
      upgrade(db, oldVersion) {
        // Drop old stores from v1
        if (oldVersion < 2) {
          if (db.objectStoreNames.contains('conversations' as never)) {
            db.deleteObjectStore('conversations' as never);
          }
          if (db.objectStoreNames.contains('messages' as never)) {
            db.deleteObjectStore('messages' as never);
          }
        }

        const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('by-updatedAt', 'updatedAt');

        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('by-conversationId', 'conversationId');
      },
    });
  }
  return dbPromise;
}

// --- Conversation operations ---

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('conversations', 'by-updatedAt');
  return all.reverse(); // newest first
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const db = await getDB();
  await db.put('conversations', conv);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['conversations', 'messages'], 'readwrite');
  await tx.objectStore('conversations').delete(id);
  const msgIndex = tx.objectStore('messages').index('by-conversationId');
  const keys = await msgIndex.getAllKeys(id);
  await Promise.all(keys.map((k) => tx.objectStore('messages').delete(k)));
  await tx.done;
}

// --- Message operations ---

export async function getMessages(conversationId: string): Promise<AgentMessage[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex('messages', 'by-conversationId', conversationId);
  rows.sort((a, b) => a.seq - b.seq);
  return rows.map((r) => r.data);
}

/** Persist an array of AgentMessages (appends after existing, using offset for seq) */
export async function appendMessages(
  conversationId: string,
  messages: AgentMessage[],
  seqOffset: number,
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('messages', 'readwrite');
  for (let i = 0; i < messages.length; i++) {
    const stored: StoredMessage = {
      id: `${conversationId}:${seqOffset + i}`,
      conversationId,
      seq: seqOffset + i,
      data: messages[i],
    };
    tx.objectStore('messages').put(stored);
  }
  await tx.done;
}
