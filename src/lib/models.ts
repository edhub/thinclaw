/**
 * Model definitions for bianxie.ai (OpenAI-compatible proxy).
 * All models use the openai-completions API with explicit compat overrides
 * to disable features the proxy doesn't support (store, developer role, etc.)
 */
import type { Model, OpenAICompletionsCompat } from '@mariozechner/pi-ai';

/** Shared compat settings for all bianxie.ai models */
const bianxieCompat: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsUsageInStreaming: false, // conservative for proxy
  maxTokensField: 'max_tokens',
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false, // thinking comes back as reasoning_content field
  supportsStrictMode: false,
};

export const MODELS: Model<'openai-completions'>[] = [
  {
    id: 'claude-haiku-4-5-20251001-thinking',
    name: 'Claude Haiku 4.5 (Thinking)',
    api: 'openai-completions',
    provider: 'bianxie',
    baseUrl: 'https://api.bianxie.ai/v1',
    reasoning: true, // emits ThinkingContent blocks via reasoning_content field
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 16000,
    compat: bianxieCompat,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    api: 'openai-completions',
    provider: 'bianxie',
    baseUrl: 'https://api.bianxie.ai/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
    compat: bianxieCompat,
  },
  {
    id: 'gemini-3-flash-preview-thinking',
    name: 'Gemini 3 Flash (Thinking)',
    api: 'openai-completions',
    provider: 'bianxie',
    baseUrl: 'https://api.bianxie.ai/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000000,
    maxTokens: 8192,
    compat: bianxieCompat,
  },
];

export const DEFAULT_MODEL_ID = MODELS[0].id;

export function getModelById(id: string): Model<'openai-completions'> {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}
