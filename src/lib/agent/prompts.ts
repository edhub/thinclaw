/**
 * System prompt builder.
 *
 * Returns a { stableParts, memoryPart } structure so the caller can apply
 * prompt-cache breakpoints in the API payload.  The Anthropic onPayload hook
 * in chat.ts converts this into separate system blocks and adds cache_control
 * to the last block (memory if present, otherwise the last stable part),
 * caching the entire system prompt prefix with a single breakpoint.
 *
 * Part layout:
 *   stableParts[0]  Soul + How-You-Operate  (changes only on soul_update)
 *   stableParts[1]  Active Persona          (omitted if none; stable per conversation)
 *   stableParts[2]  Custom Instructions     (omitted if empty; stable per settings)
 *   memoryPart      Memories                (omitted if none; cached — changes only
 *                                            on explicit memory_save/delete calls,
 *                                            less frequent than persona selection)
 */
import type { Memory } from '$lib/db'

export interface SystemPromptParts {
  /** Stable parts that should receive cache_control in the API payload. */
  stableParts: string[]
  /** Memory block — injected last; cached alongside stable parts (single breakpoint on the last block). */
  memoryPart?: string
}

/** Format a memory list into the text injected into the memory system block. */
export function formatMemoriesForPrompt(mems: Memory[]): string {
  if (mems.length === 0) return ''
  return mems
    .map((m) => {
      const date = new Date(m.createdAt).toLocaleDateString('en-CA') // YYYY-MM-DD
      return `- [${date}] ${m.content}`
    })
    .join('\n')
}

/**
 * Assemble the system prompt parts from soul + persona + custom instructions + memories.
 *
 * @param soulContent        Current soul Markdown (from soul store).
 * @param personaContent     Optional active persona prompt content.
 * @param customInstructions Optional user-supplied extra instructions.
 * @param memoriesText       Pre-formatted memory block (from formatMemoriesForPrompt).
 */
export function buildSystemPrompt(
  soulContent: string,
  personaContent?: string,
  customInstructions?: string,
  memoriesText?: string,
): SystemPromptParts {
  const stableParts: string[] = []

  // Part 1: Soul + How You Operate (always present)
  stableParts.push(soulContent.trim())

  // Part 2: Active Persona (omit if none selected)
  if (personaContent?.trim()) {
    stableParts.push(
      `## Active Persona\n\nYou are temporarily playing the following role in this conversation. ` +
        `Your soul and core identity remain unchanged — this persona shapes *how* you behave here, not *who* you are.\n\n---\n\n${personaContent.trim()}`,
    )
  }

  // Part 3: Custom instructions (omit if empty)
  if (customInstructions?.trim()) {
    stableParts.push(`## Custom Instructions\n\n${customInstructions.trim()}`)
  }

  // Memory block — separate from stable parts so it can be sent without cache_control.
  const memoryPart = memoriesText?.trim()
    ? `## Your Memory\n\nFacts you have learned about the user across past conversations:\n\n${memoriesText.trim()}`
    : undefined

  return { stableParts, memoryPart }
}
