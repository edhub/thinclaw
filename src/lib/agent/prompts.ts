/**
 * System prompt builder.
 *
 * Returns a { stableParts, memoryPart } structure so the caller can apply
 * prompt-cache breakpoints only on the stable parts (soul, persona, custom
 * instructions) while leaving the memory block un-cached.  This way, a
 * memory_save call changes only the last system block — earlier blocks stay
 * byte-for-byte identical and keep hitting Anthropic's prefix cache.
 *
 * Part layout:
 *   stableParts[0]  Soul + How-You-Operate  (changes only on soul_update)
 *   stableParts[1]  Active Persona          (omitted if none; stable per conversation)
 *   stableParts[2]  Custom Instructions     (omitted if empty; stable per settings)
 *   memoryPart      Memories                (omitted if none; excluded from caching)
 */
import type { Memory } from '$lib/db'

export interface SystemPromptParts {
  /** Stable parts that should receive cache_control in the API payload. */
  stableParts: string[]
  /** Memory block — injected last, not cached (changes on every memory_save). */
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
  stableParts.push(
    soulContent.trim() +
      `\n\n## How You Operate

- Your soul is your identity. When it needs to evolve, call \`soul_update\` with the full new content — then tell the user what changed and why.
- Use \`memory_save\` to persist stable identity facts about the user (name, language, key long-term preferences). Keep this small and high-quality (fewer than ~10 entries).
- Use \`memory_delete\` to remove stale or incorrect entries. The memory ID is shown in the **Your Memory** section of your context.
- Available tools: \`calculate\`, \`get_datetime\`, \`soul_update\`, \`soul_read\`, \`memory_save\`, \`memory_delete\``,
  )

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
