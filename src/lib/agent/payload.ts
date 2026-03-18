/**
 * onPayload hook — splits the system prompt into multiple parts and
 * applies provider-specific cache breakpoints before each API call.
 *
 * Also captures request payloads for session JSONL debugging.
 *
 * Provider routing (detected from payload shape):
 *
 *   Google     `params.contents` array present (not `messages`).
 *              Rewrites `params.config.systemInstruction` from a single string to
 *              a Content object with one part per prompt section.
 *
 *   Anthropic  `params.system` is a top-level array of text blocks.
 *              Rewrites to one block per prompt section with cache_control on the
 *              last block. Also adds cache_control to tools[-1] and removes
 *              pi-ai auto-injected cache_control on the last user message.
 *
 *   OpenAI     `params.messages` present but no `params.system` array.
 *              No cache_control support — passes through untouched.
 */
import type { SessionPayloadEntry } from '$lib/fs/session-recorder'

export interface SystemPromptParts {
  stableParts: string[]
  memoryPart?: string
}

/**
 * Mutable state shared between the payload hook and the chat store.
 * Updated by assembleSystemPrompt() in chat.ts before each agent.prompt().
 */
export let currentSystemPromptParts: SystemPromptParts | null = null

export function setCurrentSystemPromptParts(parts: SystemPromptParts | null): void {
  currentSystemPromptParts = parts
}

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
    if (currentSystemPromptParts && params.config?.systemInstruction) {
      const { stableParts, memoryPart } = currentSystemPromptParts
      const allParts = [...stableParts, ...(memoryPart ? [memoryPart] : [])]
      if (allParts.length > 1) {
        params.config.systemInstruction = {
          role: 'user',
          parts: allParts.map((text) => ({ text })),
        }
      }
    }

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
    // Rebuild system as multiple blocks (one per prompt part).
    if (currentSystemPromptParts) {
      const { stableParts, memoryPart } = currentSystemPromptParts
      const blocks: { type: string; text: string; cache_control?: { type: string } }[] = []

      for (const part of stableParts) {
        blocks.push({ type: 'text', text: part })
      }
      if (memoryPart) {
        blocks.push({ type: 'text', text: memoryPart })
      }
      // cache_control on the last block (memory if present, else last stable part).
      if (blocks.length > 0) {
        blocks[blocks.length - 1].cache_control = { type: 'ephemeral' }
      }
      if (blocks.length > 0) {
        params.system = blocks
      }
    }

    // Add cache_control to the last tool definition (always stable).
    if (Array.isArray(params.tools) && params.tools.length > 0) {
      params.tools[params.tools.length - 1].cache_control = { type: 'ephemeral' as const }
    }

    // Remove the cache_control that pi-ai auto-injects on the last user message.
    for (const msg of params.messages) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control
        }
      }
    }
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
