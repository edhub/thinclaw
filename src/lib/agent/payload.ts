/**
 * onPayload hook — applies provider-specific cache settings before each API call,
 * and captures request payloads for session JSONL debugging.
 *
 * Provider routing (detected from payload shape):
 *
 *   Google     `params.contents` array present.
 *              Passes through unchanged — system prompt is already a single string
 *              set via agent.setSystemPrompt().
 *
 *   Anthropic  `params.system` is a top-level array of text blocks.
 *              Adds a cache_control breakpoint on the last tool definition so the
 *              stable tools prefix (~2,420 tokens) is always cached. pi-ai's own
 *              breakpoints on the system block and last user message are left
 *              untouched (system is a no-op due to token threshold; last user
 *              message enables incremental conversation-history caching).
 *
 *   OpenAI     `params.messages` present but no `params.system` array.
 *              No cache_control support — passes through untouched.
 */
import type { SessionPayloadEntry } from '$lib/fs/session-recorder'

/**
 * Captured LLM request payloads for the current agent run.
 * Cleared at the start of each prompt() and written to session JSONL on agent_end.
 */
export let capturedPayloads: SessionPayloadEntry[] = []

export function clearCapturedPayloads(): void {
  capturedPayloads = []
}

/**
 * The unified onPayload hook passed to the Agent constructor.
 */
export function onPayload(payload: unknown): unknown {
  const params = payload as Record<string, any>

  // ── Google ────────────────────────────────────────────────────────────────
  if (Array.isArray(params.contents)) {
    try {
      capturedPayloads.push({
        type: 'payload',
        timestamp: Date.now(),
        params: JSON.parse(JSON.stringify(params)),
      })
    } catch {
      // Non-fatal.
    }
    return params
  }

  // ── Anthropic / OpenAI (both use `messages` array) ────────────────────────
  if (!Array.isArray(params.messages)) return payload

  const isAnthropic = Array.isArray(params.system)

  if (isAnthropic) {
    // Strip all cache_control from tools and message content blocks.
    // Only the system-level breakpoint (placed by pi-ai on system[-1]) is kept.
    // This avoids proxy services that reject requests with >N cache_control blocks.
    stripCacheControl(params)
  }

  // Capture a deep copy of the final params for session recording / debugging.
  try {
    capturedPayloads.push({
      type: 'payload',
      timestamp: Date.now(),
      params: JSON.parse(JSON.stringify(params)),
    })
  } catch {
    // Non-fatal — don't break the agent if serialization fails.
  }

  return params
}

/**
 * Strip cache_control from all tools and message content blocks.
 * Leaves system blocks untouched — the top-level system breakpoint is the
 * only one retained, avoiding proxy rejections on the 4-block limit.
 */
function stripCacheControl(params: Record<string, any>): void {
  if (Array.isArray(params.tools)) {
    for (const tool of params.tools) {
      delete tool.cache_control
    }
  }

  if (Array.isArray(params.messages)) {
    for (const msg of params.messages) {
      if (Array.isArray(msg?.content)) {
        for (const block of msg.content) {
          delete block.cache_control
        }
      }
    }
  }
}
