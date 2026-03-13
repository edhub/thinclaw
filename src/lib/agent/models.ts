/**
 * Model definitions for bianxie.ai proxy.
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
    name: 'Gemini 3.1 Flash Lite (Thinking)',
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
    name: 'Gemini 3 Flash (Thinking)',
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
    name: 'Grok 4.20 Beta (Reasoning)',
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
    name: 'Claude Haiku 4.5 (Thinking)',
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
    name: 'Claude Haiku 4.5',
    api: 'anthropic-messages',
    provider: 'bianxie',
    baseUrl: 'https://api.bianxie.ai',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  },
]

export const DEFAULT_MODEL_ID = 'claude-haiku-4-5-20251001-thinking'
export const DEFAULT_UTILITY_MODEL_ID = 'gemini-3.1-flash-lite-preview'

export function getModelById(id: string): Model<'anthropic-messages' | 'google-generative-ai'> {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]
}
