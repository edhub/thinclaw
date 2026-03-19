/**
 * System prompt builder.
 *
 * Assembles all parts (soul, persona, custom instructions, memories) into a
 * single string passed to agent.setSystemPrompt(). Prompt caching is handled
 * automatically by pi-ai (cacheRetention="short" default), which adds
 * cache_control to system blocks, tools, and the last user message.
 */
import type { Memory } from '$lib/db'

/** Format a memory list into the text injected at the end of the system prompt. */
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
 * Assemble the full system prompt string from soul + persona + custom instructions + memories.
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
): string {
  const parts: string[] = []

  // Soul + How You Operate (always present)
  parts.push(soulContent.trim())

  // Active Persona (omit if none selected)
  if (personaContent?.trim()) {
    parts.push(
      `## Active Persona\n\nYou are temporarily playing the following role in this conversation. ` +
        `Your soul and core identity remain unchanged — this persona shapes *how* you behave here, not *who* you are.\n\n---\n\n${personaContent.trim()}`,
    )
  }

  // Custom instructions (omit if empty)
  if (customInstructions?.trim()) {
    parts.push(`## Custom Instructions\n\n${customInstructions.trim()}`)
  }

  // Memories (omit if none)
  if (memoriesText?.trim()) {
    parts.push(
      `## Your Memory\n\nFacts you have learned about the user across past conversations:\n\n${memoriesText.trim()}`,
    )
  }

  return parts.join('\n\n')
}
