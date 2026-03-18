/**
 * Convert AgentMessage[] → Message[] for the LLM.
 *
 * Handles:
 *   - CompactionSummaryMessage → user message with summary prefix
 *   - Error filtering: error assistant messages + preceding user messages are excluded
 *   - Thinking block redaction: older thinking blocks → redacted form for Anthropic compliance
 */
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { Message } from '@mariozechner/pi-ai'
import type { CompactionSummaryMessage } from '$lib/agent/compaction'

/**
 * Convert AgentMessage[] → Message[] for the LLM.
 *
 * Error filtering: assistant messages with stopReason==='error' or errorMessage set
 * are excluded, along with their immediately preceding user message (the failed
 * request pair). This prevents broken exchanges from polluting the AI's context.
 */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  // Build the set of indices to skip: error assistant messages + preceding user messages.
  const skipSet = new Set<number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as any
    if (msg.role === 'assistant' && (msg.stopReason === 'error' || msg.errorMessage)) {
      skipSet.add(i)
      if (i > 0 && messages[i - 1].role === 'user') skipSet.add(i - 1)
    }
  }

  // Keep thinking blocks only for assistant messages within the last 3 user-turn
  // "blocks" (anchored on user message boundaries, not assistant count).
  //
  // WHY 3 turns (not 2): Anthropic prompt cache is prefix-based. If a thinking
  // block changes form between consecutive LLM calls (e.g. from full `thinking`
  // to `redacted_thinking`), the serialized bytes change, breaking the prefix
  // match and causing a full cache rewrite. With 2 turns, the boundary shifts
  // every new user message, causing the oldest kept thinking block to get
  // redacted — exactly when the prefix needs to stay stable. 3 turns gives a
  // buffer: blocks only get redacted when they're far enough back that the
  // prefix up to that point was already cached in a previous call.
  //
  // WHY user boundaries (not assistant count): a tool call adds a new assistant
  // message mid-turn, shifting an assistant-count window. User message indices
  // are stable within a tool-call sequence, so keepThinkingFromIdx stays the
  // same in Call #1 (tool call) and Call #2 (tool result) → identical prefix.
  const assistantIndices = messages
    .map((m, i) => ((m as any).role === 'assistant' ? i : -1))
    .filter((i) => i !== -1)
  const userIndices = messages
    .map((m, i) => ((m as any).role === 'user' ? i : -1))
    .filter((i) => i !== -1)
  // Start of the third-to-last user turn; keep thinking for all assistant
  // messages at or after that boundary.
  const keepThinkingFromIdx = userIndices.length >= 3 ? userIndices[userIndices.length - 3] : 0
  const recentAssistantSet = new Set(assistantIndices.filter((i) => i >= keepThinkingFromIdx))

  const converted = messages.flatMap((m, i) => {
    if (skipSet.has(i)) return []
    const msg = m as any
    if (msg.role === 'compactionSummary') {
      const cs = m as CompactionSummaryMessage
      return [
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: `[Summary of previous conversation]\n\n${cs.summary}`,
            },
          ],
          timestamp: cs.timestamp,
        } satisfies Message,
      ]
    }
    if (msg.role === 'assistant') {
      if (recentAssistantSet.has(i)) return [m as Message]
      // For older assistant messages, convert thinking blocks to "redacted" form:
      //   { ...block, thinking: '', redacted: true }
      // anthropic.js will then send  { type: "redacted_thinking", data: signature }
      // which is Anthropic's official compact format (opaque payload only, no text).
      //
      // If a block has no signature (e.g. aborted mid-stream), we cannot create a
      // valid redacted_thinking entry, so we drop it.
      const content = (msg.content ?? []).flatMap((b: any) => {
        if (b.type !== 'thinking') return [b]
        if (b.thinkingSignature?.trim()) {
          // Keep signature, discard text content for token efficiency.
          return [{ ...b, thinking: '', redacted: true }]
        }
        // No signature → drop to avoid API rejection.
        return []
      })
      // If stripping left an empty content array, skip the message entirely.
      if (content.length === 0) return []
      return [{ ...msg, content } as Message]
    }
    if (msg.role === 'user' || msg.role === 'toolResult') {
      return [m as Message]
    }
    return []
  })

  return converted
}
