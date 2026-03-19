/**
 * onPayload hook — captures request payloads for session JSONL debugging.
 *
 * Cache control is fully managed by pi-ai (via the built-in cacheRetention="short"
 * default). This hook does NOT modify payloads — it only takes a deep-copy snapshot
 * for offline debugging in the SessionViewer.
 *
 * Provider routing is transparent: Google (`params.contents`), Anthropic
 * (`params.system` array), and OpenAI (`params.messages`) all pass through unchanged.
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
 * Captures a deep-copy of every outgoing LLM request for session recording,
 * then returns the payload unchanged.
 */
export function onPayload(payload: unknown): unknown {
  try {
    capturedPayloads.push({
      type: 'payload',
      timestamp: Date.now(),
      params: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
    })
  } catch {
    // Non-fatal — don't break the agent if serialization fails.
  }
  return payload
}
