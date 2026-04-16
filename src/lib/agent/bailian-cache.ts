/**
 * Injects explicit cache markers and disables thinking for DashScope (Bailian) requests.
 *
 * --- Explicit cache ---
 * DashScope supports Anthropic-style cache_control markers in OpenAI-compatible payloads.
 * pi-ai's openai-completions provider does NOT inject these automatically for arbitrary
 * providers (only for openrouter+Anthropic). This module handles bailian explicitly.
 *
 * Strategy (mirrors what pi-ai's Anthropic provider does internally):
 *   - Breakpoint 1: end of system message  → caches stable prefix (soul + persona + memories)
 *   - Breakpoint 2: end of last user message → caches full conversation history
 *
 * Min cacheable content: 1024 tokens. Markers on shorter content are silently ignored
 * by DashScope — the request succeeds, just no cache block is created.
 *
 * --- Thinking (enable_thinking) ---
 * Qwen3.x models default to thinking ON when enable_thinking is omitted.
 * pi-ai only sends enable_thinking when model.reasoning=true + compat.thinkingFormat='qwen'.
 * Since our models have reasoning:false (thinking disabled for now), we must explicitly
 * inject enable_thinking:false to override the model's built-in default.
 *
 * Ref: https://help.aliyun.com/zh/model-studio/context-cache
 */

const CACHE_CONTROL = { type: 'ephemeral' } as const

type ContentPart = { type: string; text?: string; cache_control?: typeof CACHE_CONTROL }
type OAIMessage = { role: string; content: string | ContentPart[] }
type OAIPayload = { messages?: OAIMessage[]; enable_thinking?: boolean }

/**
 * Converts a message's content to array form and appends cache_control to the last
 * text part. Returns true if a marker was added.
 */
function markMessage(msg: OAIMessage): boolean {
  if (typeof msg.content === 'string') {
    msg.content = [{ type: 'text', text: msg.content, cache_control: CACHE_CONTROL }]
    return true
  }
  if (Array.isArray(msg.content)) {
    for (let i = msg.content.length - 1; i >= 0; i--) {
      const part = msg.content[i]
      if (part?.type === 'text') {
        part.cache_control = CACHE_CONTROL
        return true
      }
    }
  }
  return false
}

/**
 * Injects explicit cache markers and disables thinking into a DashScope
 * OpenAI-compatible payload. Mutates the payload in place.
 */
export function injectBailianCacheControl(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const p = payload as OAIPayload

  // Disable thinking — Qwen3.x defaults to ON when omitted.
  p.enable_thinking = false

  if (!Array.isArray(p.messages) || p.messages.length === 0) return payload

  // Breakpoint 1: system message
  const systemMsg = p.messages.find((m) => m.role === 'system')
  if (systemMsg) markMessage(systemMsg)

  // Breakpoint 2: last user message
  for (let i = p.messages.length - 1; i >= 0; i--) {
    if (p.messages[i].role === 'user') {
      markMessage(p.messages[i])
      break
    }
  }

  return payload
}
