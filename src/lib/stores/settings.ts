/**
 * Settings store — persisted to localStorage.
 * Holds API key, selected model, and theme preference.
 */
import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

export const MODELS = [
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];
export type Theme = 'light' | 'dark' | 'system';

export interface Settings {
  apiKey: string;
  model: ModelId;
  theme: Theme;
  systemPrompt: string;
}

const STORAGE_KEY = 'thinclaw:settings';

const DEFAULTS: Settings = {
  apiKey: '',
  model: 'gpt-4o',
  theme: 'system',
  systemPrompt: 'You are a helpful assistant.',
};

function loadFromStorage(): Settings {
  if (!browser) return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
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
