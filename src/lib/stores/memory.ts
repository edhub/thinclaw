/**
 * Memory store — reactive wrapper around the IndexedDB memories table.
 *
 * Memories are global (cross-conversation), persisted in IndexedDB.
 * The store is loaded once at app start and kept in sync as tools add/remove entries.
 */
import { writable, get } from 'svelte/store';
import { listMemories, saveMemory, deleteMemory, searchMemories, type Memory } from '$lib/db';
import { nanoid } from '$lib/utils/nanoid';

export type { Memory };

function createMemoryStore() {
  const inner = writable<Memory[]>([]);

  return {
    subscribe: inner.subscribe,

    /** Load all memories from IndexedDB into the store. Call once at app start. */
    async load(): Promise<void> {
      const list = await listMemories();
      inner.set(list);
    },

    /** Save a new memory entry, update the store. Returns the saved memory. */
    async add(content: string): Promise<Memory> {
      const now = Date.now();
      const mem: Memory = { id: nanoid(), content, createdAt: now, updatedAt: now };
      await saveMemory(mem);
      inner.update((list) => [mem, ...list]);
      return mem;
    },

    /** Delete a memory by id, update the store. */
    async remove(id: string): Promise<void> {
      await deleteMemory(id);
      inner.update((list) => list.filter((m) => m.id !== id));
    },

    /** Keyword search (delegates to DB). Does not require store to be loaded. */
    async search(query: string): Promise<Memory[]> {
      return searchMemories(query);
    },

    /** Synchronously read the current list (valid after load()). */
    all(): Memory[] {
      return get(inner);
    },
  };
}

export const memories = createMemoryStore();
