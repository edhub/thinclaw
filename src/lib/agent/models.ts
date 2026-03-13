/**
 * Model definitions.
 *
 * Each entry represents a (model × provider) combination — selecting a model
 * implicitly selects the provider too. The unique app-level key is:
 *   modelKey(m) = `${m.provider}:${m.id}`
 *
 * This key is what gets stored in Settings.model and compared in the UI.
 * m.id is still the raw model name sent to the API.
 *
 * Claude models  → Anthropic Messages API  (native format, POST /v1/messages)
 * Gemini models  → Google Generative AI API (native format, POST /v1beta/models/…)
 *
 * Using native formats gives access to provider-specific features:
 *   - Anthropic: extended thinking, cache control, fine-grained tool streaming
 *   - Google: thinkingConfig, thoughtSignature, native tool use
 */
import type { Model } from '@mariozechner/pi-ai'

export const MODELS: Model<'anthropic-messages' | 'google-generative-ai'>[] = [
  // ── Google Gemini (via bianxie) ─────────────────────────────────────────────
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash Lite (Thinking) · bianxie',
    api: 'google-generative-ai',
    provider: 'bianxie',
    baseUrl: 'https://api.bianxie.ai/v1beta',
    // Uses thinkingLevel enum (not budgetTokens); pi-ai maps effort→level for Gemini 3 Flash models
    // medium effort → thinkingLevel: "MEDIUM"
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  },
  {
    id: 'gemini-3-flash-preview-thinking',
    name: 'Gemini 3 Flash (Thinking) · bianxie',
    api: 'google-generative-ai',
    provider: 'bianxie',
    // pi-ai sets apiVersion="" when baseUrl is provided, so include version here
    baseUrl: 'https://api.bianxie.ai/v1beta',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  },

  // ── xAI Grok (via bianxie, Anthropic Messages API) ─────────────────────────
  {
    id: 'grok-4.20-beta-0309-reasoning',
    name: 'Grok 4.20 Beta (Reasoning) · bianxie',
    api: 'anthropic-messages',
    provider: 'bianxie',
    baseUrl: 'https://api.bianxie.ai', // SDK appends /v1/messages
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 16000,
  },

  // ── Anthropic (via bianxie) ─────────────────────────────────────────────────
  {
    id: 'claude-haiku-4-5-20251001-thinking',
    name: 'Claude Haiku 4.5 (Thinking) · bianxie',
    api: 'anthropic-messages',
    provider: 'bianxie',
    baseUrl: 'https://api.bianxie.ai', // SDK appends /v1/messages
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 16000,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5 · bianxie',
    api: 'anthropic-messages',
    provider: 'bianxie',
    baseUrl: 'https://api.bianxie.ai',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  },

  // ── Anthropic (via laozhang.ai) ─────────────────────────────────────────────
  {
    id: 'claude-haiku-4-5-20251001-thinking',
    name: 'Claude Haiku 4.5 (Thinking) · 老张',
    api: 'anthropic-messages',
    provider: 'laozhang',
    baseUrl: 'https://api.laozhang.ai', // SDK appends /v1/messages
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 16000,
  },

  // ── Google Gemini (via laozhang.ai) ─────────────────────────────────────────
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash Lite (Thinking) · 老张',
    api: 'google-generative-ai',
    provider: 'laozhang',
    baseUrl: 'https://api.laozhang.ai/v1beta',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  },
]

/** Unique app-level key for a (model × provider) combination. */
export function modelKey(m: Model<any>): string {
  return `${m.provider}:${m.id}`
}

export const DEFAULT_MODEL_KEY = 'bianxie:claude-haiku-4-5-20251001-thinking'
export const DEFAULT_UTILITY_MODEL_KEY = 'bianxie:gemini-3.1-flash-lite-preview'

export function getModelByKey(key: string): Model<'anthropic-messages' | 'google-generative-ai'> {
  return MODELS.find((m) => modelKey(m) === key) ?? MODELS[0]
}
