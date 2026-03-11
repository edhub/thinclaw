/**
 * IndexedDB schema and initialization via idb.
 * Stores: conversations, messages
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

interface ThinClawDB extends DBSchema {
  conversations: {
    key: string;
    value: Conversation;
    indexes: { 'by-updatedAt': number };
  };
  messages: {
    key: string;
    value: Message;
    indexes: { 'by-conversationId': string; 'by-createdAt': number };
  };
}

let dbPromise: Promise<IDBPDatabase<ThinClawDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<ThinClawDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ThinClawDB>('thinclaw', 1, {
      upgrade(db) {
        const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
        convStore.createIndex('by-updatedAt', 'updatedAt');

        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('by-conversationId', 'conversationId');
        msgStore.createIndex('by-createdAt', 'createdAt');
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

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const db = await getDB();
  return db.get('conversations', id);
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const db = await getDB();
  await db.put('conversations', conv);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['conversations', 'messages'], 'readwrite');
  await tx.objectStore('conversations').delete(id);
  // Delete all messages for this conversation
  const msgIndex = tx.objectStore('messages').index('by-conversationId');
  const keys = await msgIndex.getAllKeys(id);
  await Promise.all(keys.map((k) => tx.objectStore('messages').delete(k)));
  await tx.done;
}

// --- Message operations ---

export async function getMessages(conversationId: string): Promise<Message[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('messages', 'by-conversationId', conversationId);
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveMessage(msg: Message): Promise<void> {
  const db = await getDB();
  await db.put('messages', msg);
}

export async function updateMessageContent(id: string, content: string): Promise<void> {
  const db = await getDB();
  const msg = await db.get('messages', id);
  if (msg) {
    await db.put('messages', { ...msg, content });
  }
}
