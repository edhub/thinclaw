/**
 * Settings store — persisted to localStorage.
 * Holds API key, selected model, theme, and optional custom system prompt.
 *
 * The persona concept has been removed — the AI's identity is managed
 * entirely through the soul (see src/lib/soul.ts).
 */
import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { MODELS, DEFAULT_MODEL_ID } from '$lib/agent/models';

export { MODELS };

export type Theme = 'light' | 'dark' | 'system';

export interface Settings {
  apiKey: string;
  model: string;        // Model id from MODELS
  theme: Theme;
  systemPrompt: string; // Optional extra instructions appended to the system prompt
}

const STORAGE_KEY = 'thinclaw:settings';

const DEFAULTS: Settings = {
  apiKey: '',
  model: DEFAULT_MODEL_ID,
  theme: 'system',
  systemPrompt: '',
};

function loadFromStorage(): Settings {
  if (!browser) return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    // Spread over defaults so new fields added later get their default value
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function createSettingsStore() {
  const store = writable<Settings>(loadFromStorage());

  return {
    subscribe: store.subscribe,
    set(value: Settings) {
      store.set(value);
      if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    },
    update(fn: (s: Settings) => Settings) {
      const next = fn(get(store));
      store.set(next);
      if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    },
  };
}

export const settings = createSettingsStore();
