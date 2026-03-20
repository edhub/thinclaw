/**
 * Settings store — persisted to localStorage.
 *
 * Fields:
 *   laozhangApiKey   — laozhang.ai API key
 *   enabledModelKeys — explicit list of enabled model keys ([] = all models whose provider has a key)
 *   model            — active conversation model key (`${provider}:${modelId}`)
 *   utilityModelKey  — utility model key (compaction, auto-title)
 *   systemPrompt     — extra instructions appended to the system prompt
 *   toolCallDelay    — minimum delay (seconds) between consecutive API calls
 */
import { writable, get } from 'svelte/store'
import { browser } from '$app/environment'
import {
  MODELS,
  DEFAULT_MODEL_KEY,
  DEFAULT_UTILITY_MODEL_KEY,
  modelKey,
  getModelByKey,
} from '$lib/agent/models'
import type { Model } from '@mariozechner/pi-ai'

export { MODELS, modelKey, getModelByKey }

export interface Settings {
  laozhangApiKey: string
  bianxieApiKey: string
  lingyaaiApiKey: string
  qiniuApiKey: string
  enabledModelKeys: string[] // [] means all models of providers with keys
  model: string // active model key: `${provider}:${modelId}`
  utilityModelKey: string // utility model key (compaction / auto-title)
  systemPrompt: string
  /** Minimum delay (seconds) between consecutive API calls. Range: 2–10. Default: 4. */
  toolCallDelay: number
}

const STORAGE_KEY = 'thinclaw:settings'

const DEFAULTS: Settings = {
  laozhangApiKey: '',
  bianxieApiKey: '',
  lingyaaiApiKey: '',
  qiniuApiKey: '',
  enabledModelKeys: [],
  model: DEFAULT_MODEL_KEY,
  utilityModelKey: DEFAULT_UTILITY_MODEL_KEY,
  systemPrompt: '',
  toolCallDelay: 4,
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns true if the given provider has an API key configured. */
function hasProviderKey(provider: string, s: Settings): boolean {
  if (provider === 'laozhang') return !!s.laozhangApiKey
  if (provider === 'bianxie') return !!s.bianxieApiKey
  if (provider === 'lingyaai') return !!s.lingyaaiApiKey
  if (provider === 'qiniu') return !!s.qiniuApiKey
  return false
}

/** Returns the API key for the given provider, or undefined if not configured. */
export function getApiKeyForProvider(provider: string, s: Settings): string | undefined {
  if (provider === 'laozhang') return s.laozhangApiKey || undefined
  if (provider === 'bianxie') return s.bianxieApiKey || undefined
  if (provider === 'lingyaai') return s.lingyaaiApiKey || undefined
  if (provider === 'qiniu') return s.qiniuApiKey || undefined
  return undefined
}

/** All models whose provider currently has a key configured (ignores enabledModelKeys). */
export function getKeyedModels(s: Settings): Model<any>[] {
  return MODELS.filter((m) => hasProviderKey(m.provider, s))
}

/**
 * Models that are both keyed (provider has API key) and enabled
 * (in enabledModelKeys, or all if that list is empty).
 */
export function getAvailableModels(s: Settings): Model<any>[] {
  return MODELS.filter((m) => {
    if (!hasProviderKey(m.provider, s)) return false
    if (s.enabledModelKeys.length === 0) return true
    return s.enabledModelKeys.includes(modelKey(m))
  })
}

/**
 * Whether a specific model is currently enabled (checked in the settings UI).
 * A model is enabled if it has a key AND is in enabledModelKeys (or list is empty).
 */
export function isModelEnabled(m: Model<any>, s: Settings): boolean {
  if (!hasProviderKey(m.provider, s)) return false
  if (s.enabledModelKeys.length === 0) return true
  return s.enabledModelKeys.includes(modelKey(m))
}

/**
 * Auto-correct model/utilityModelKey if the current selection is no longer available.
 * Returns the corrected settings object.
 */
function applyAutoCorrect(s: Settings): Settings {
  const available = getAvailableModels(s)
  if (available.length === 0) return s

  let { model, utilityModelKey } = s

  if (!available.find((m) => modelKey(m) === model)) {
    model = modelKey(available[0])
  }
  if (!available.find((m) => modelKey(m) === utilityModelKey)) {
    const defUtil = available.find((m) => modelKey(m) === DEFAULT_UTILITY_MODEL_KEY)
    utilityModelKey = defUtil ? DEFAULT_UTILITY_MODEL_KEY : modelKey(available[0])
  }

  return { ...s, model, utilityModelKey }
}

// ── Storage ────────────────────────────────────────────────────────────────────

function loadFromStorage(): Settings {
  if (!browser) return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed: Settings = { ...DEFAULTS, ...JSON.parse(raw) }
    // Validate stored model keys; fall back to defaults if they no longer exist.
    if (!MODELS.find((m) => modelKey(m) === parsed.model)) {
      parsed.model = DEFAULT_MODEL_KEY
    }
    if (!MODELS.find((m) => modelKey(m) === parsed.utilityModelKey)) {
      parsed.utilityModelKey = DEFAULT_UTILITY_MODEL_KEY
    }
    // Ensure enabledModelKeys is always an array.
    if (!Array.isArray(parsed.enabledModelKeys)) {
      parsed.enabledModelKeys = []
    }
    return parsed
  } catch {
    return DEFAULTS
  }
}

function saveToStorage(s: Settings): void {
  if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

// ── Store ──────────────────────────────────────────────────────────────────────

function createSettingsStore() {
  const store = writable<Settings>(loadFromStorage())

  return {
    subscribe: store.subscribe,
    set(value: Settings) {
      store.set(value)
      saveToStorage(value)
    },
    update(fn: (s: Settings) => Settings) {
      const next = fn(get(store))
      store.set(next)
      saveToStorage(next)
    },
  }
}

export const settings = createSettingsStore()

/**
 * Apply a partial update with auto-correction for model selection.
 * Use this for key changes and model toggling instead of `settings.update()` directly.
 */
export function updateSettings(patch: Partial<Settings>): void {
  settings.update((s) => applyAutoCorrect({ ...s, ...patch }))
}
