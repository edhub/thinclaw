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

export const MODELS: Model<'anthropic-messages' | 'google-generative-ai' | 'openai-completions'>[] =
  [
    // ── Anthropic (via laozhang.ai) ───────────────────────────────────────────
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

    // ── Google Gemini (via laozhang.ai) ───────────────────────────────────────
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

    // ── Anthropic (via bianxie.ai) ────────────────────────────────────────────
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
      id: 'claude-sonnet-4-6-thinking',
      name: 'Claude Sonnet 4.6 (Thinking) · bianxie',
      api: 'anthropic-messages',
      provider: 'bianxie',
      baseUrl: 'https://api.bianxie.ai',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16000,
    },

    // ── Google Gemini (via bianxie.ai) ────────────────────────────────────────
    {
      id: 'gemini-3.1-flash-lite-preview',
      name: 'Gemini 3.1 Flash Lite (Thinking) · bianxie',
      api: 'google-generative-ai',
      provider: 'bianxie',
      baseUrl: 'https://api.bianxie.ai/v1beta',
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
      baseUrl: 'https://api.bianxie.ai/v1beta',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 8192,
    },
    {
      id: 'gemini-3.1-pro-preview-thinking',
      name: 'Gemini 3.1 Pro (Thinking) · bianxie',
      api: 'google-generative-ai',
      provider: 'bianxie',
      baseUrl: 'https://api.bianxie.ai/v1beta',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 8192,
    },
    // {
    //   id: 'gemini-3.1-pro-preview-thinking',
    //   name: 'Gemini 3.1 pro (Thinking) · bianxie',
    //   api: 'google-generative-ai',
    //   provider: 'bianxie',
    //   baseUrl: 'https://api.bianxie.ai/v1beta',
    //   reasoning: true,
    //   input: ['text', 'image'],
    //   cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    //   contextWindow: 1000000,
    //   maxTokens: 8192,
    // },

    // ── Anthropic (via lingyaai.cn) ───────────────────────────────────────────
    {
      id: 'claude-sonnet-4-6-thinking',
      name: 'Claude Sonnet 4.6 (thinking) · 灵芽',
      api: 'anthropic-messages',
      provider: 'lingyaai',
      baseUrl: 'https://api.lingyaai.cn', // SDK appends /v1/messages
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 200000,
      maxTokens: 16000,
    },
    {
      id: 'gemini-3-flash-preview-search',
      name: 'Gemini 3 Flash Search · 灵芽',
      api: 'google-generative-ai',
      provider: 'lingyaai',
      baseUrl: 'https://api.lingyaai.cn/v1beta',
      reasoning: false,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1000000,
      maxTokens: 16000,
    },

    // ── OpenAI (via bianxie.ai) ───────────────────────────────────────────────
    // {
    //   id: 'gpt-5.4',
    //   name: 'GPT-5.4 · bianxie',
    //   api: 'openai-completions',
    //   provider: 'bianxie',
    //   baseUrl: 'https://api.bianxie.ai/v1',
    //   reasoning: false,
    //   input: ['text', 'image'],
    //   cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    //   contextWindow: 128000,
    //   maxTokens: 16384,
    // },
  ]

/** Unique app-level key for a (model × provider) combination. */
export function modelKey(m: Model<any>): string {
  return `${m.provider}:${m.id}`
}

export const DEFAULT_MODEL_KEY = 'bianxie:gemini-3-flash-preview-thinking'
export const DEFAULT_UTILITY_MODEL_KEY = 'bianxie:gemini-3.1-flash-lite-preview'

export function getModelByKey(
  key: string,
): Model<'anthropic-messages' | 'google-generative-ai' | 'openai-completions'> {
  return MODELS.find((m) => modelKey(m) === key) ?? MODELS[0]
}
