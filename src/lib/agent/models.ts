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
 * Qwen / DashScope → OpenAI Completions API (OpenAI-compatible, POST /compatible-mode/v1/chat/completions)
 *
 * Using native formats gives access to provider-specific features:
 *   - Anthropic: extended thinking, cache control, fine-grained tool streaming
 *   - Google: thinkingConfig, thoughtSignature, native tool use
 *   - Qwen/DashScope: implicit context cache (auto, 20% cached token price),
 *     explicit cache via cache_control (10% cached, 125% create)
 */
import type { Model } from '@mariozechner/pi-ai'

export const MODELS: Model<'anthropic-messages' | 'google-generative-ai' | 'openai-completions'>[] = [
  // ── 阿里百炼 · DashScope (OpenAI-compatible) ───────────────────────────────
  {
    id: 'qwen3.6-plus',
    name: '千问 3.6 Plus · 百炼',
    api: 'openai-completions',
    provider: 'bailian',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 8192,
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false },
  },
  {
    id: 'qwen3.5-flash',
    name: '千问 3.5 Flash · 百炼',
    api: 'openai-completions',
    provider: 'bailian',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131072,
    maxTokens: 8192,
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false },
  },

  // ── Google Gemini (via laozhang.ai) ───────────────────────────────────────
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3.1 Flash Lite · 老张',
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
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 · 便携',
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
    name: 'Gemini 3.1 Flash Lite · 便携',
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
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash · 便携',
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
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro · 便携',
    api: 'google-generative-ai',
    provider: 'bianxie',
    baseUrl: 'https://api.bianxie.ai/v1beta',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  },

  // ── Anthropic (via lingyaai.cn) ───────────────────────────────────────────
  {
    id: 'gemini-3.1-flash-lite-preview',
    name: 'Gemini 3 Flash Lite · 灵芽',
    api: 'google-generative-ai',
    provider: 'lingyaai',
    baseUrl: 'https://api.lingyaai.cn/v1beta',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  },
  {
    id: 'gemini-3-flash-preview',
    name: 'Gemini 3 Flash · 灵芽',
    api: 'google-generative-ai',
    provider: 'lingyaai',
    baseUrl: 'https://api.lingyaai.cn/v1beta',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 · 灵芽',
    api: 'anthropic-messages',
    provider: 'lingyaai',
    baseUrl: 'https://api.lingyaai.cn', // SDK appends /v1/messages
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 16000,
  },

  // ── Anthropic (via qiniu) ─────────────────────────────────────────────────
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6 · 七牛',
    api: 'anthropic-messages',
    provider: 'qiniu',
    baseUrl: 'https://api.qnaigc.com', // SDK appends /v1/messages
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 16000,
  },
]

/** Unique app-level key for a (model × provider) combination. */
export function modelKey(m: Model<any>): string {
  return `${m.provider}:${m.id}`
}

export const DEFAULT_MODEL_KEY = 'bianxie:gemini-3-flash-preview'
export const DEFAULT_UTILITY_MODEL_KEY = 'bianxie:gemini-3.1-flash-lite-preview'

export function getModelByKey(key: string): Model<'anthropic-messages' | 'google-generative-ai' | 'openai-completions'> {
  return MODELS.find((m) => modelKey(m) === key) ?? MODELS[0]
}
