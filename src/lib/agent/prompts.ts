/**
 * System prompt builder.
 *
 * The prompt is assembled from up to four layers:
 *   1. Soul       — the AI's identity (localStorage, editable by the AI)
 *   2. Persona    — optional temporary role for this conversation (locked after first message)
 *   3. Memory     — persistent facts saved across conversations (IndexedDB)
 *   4. Custom     — optional extra instructions from the user (Settings)
 *
 * ── Prompt caching note ──────────────────────────────────────────────────────
 * Anthropic prompt caching keys on the exact prefix up to each cache_control
 * breakpoint. Including memories in the system prompt means any memory_save
 * call busts the cache on the very next request (write → miss → write → …).
 *
 * To keep the system prompt stable, memories are injected by the chat store's
 * convertToLlm() as a synthetic (user / assistant) message pair at the start
 * of every conversation instead. Call buildSystemPrompt() with an empty
 * memoriesText to produce the cache-stable variant.
 * ────────────────────────────────────────────────────────────────────────────
 */
import type { Memory } from '$lib/db'

/**
 * Format a memory list into the block injected into the system prompt.
 * Returns an empty string when there are no memories.
 */
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
 * Assemble the full system prompt from soul + persona + memories + custom instructions.
 *
 * @param soulContent         Current soul Markdown (from soul store).
 * @param memoriesText        Pre-formatted memory block (from formatMemoriesForPrompt).
 * @param customInstructions  Optional user-supplied extra instructions.
 * @param personaContent      Optional active persona prompt content.
 */
export function buildSystemPrompt(
  soulContent: string,
  memoriesText: string,
  customInstructions?: string,
  personaContent?: string,
): string {
  const parts: string[] = []

  // Layer 1: Soul
  parts.push(`## Your Soul\n${soulContent}`)

  // Layer 2: Active Persona (omit if none selected)
  if (personaContent?.trim()) {
    parts.push(
      `## Active Persona\n\nYou are temporarily playing the following role in this conversation. ` +
        `Your soul and core identity remain unchanged — this persona shapes *how* you behave here, not *who* you are.\n\n---\n\n${personaContent.trim()}`,
    )
  }

  // Layer 3: Memory (omit section if empty)
  if (memoriesText) {
    parts.push(`## Your Memory\n${memoriesText}`)
  }

  // Layer 4: How to operate (tool guidance)
  parts.push(`## How You Operate

- Your soul is your identity. When it needs to evolve, call \`soul_update\` with the full new content — then tell the user what changed and why.
- **Memory has two tiers:**
  - \`core\` — stable identity facts (name, language, occupation, fundamental preferences). Always injected into every conversation. Keep this tier small and high-quality (aim for fewer than 10 entries).
  - \`general\` — projects, events, situational context, working preferences. Not auto-injected; use \`memory_recall\` to retrieve when relevant.
- When the user shares something worth keeping, call \`memory_save\`. Use \`tier='core'\` only for facts that are true across all contexts and unlikely to change. Default to \`tier='general'\`.
- Use \`memory_recall\` to search general memories when you need project or situational context from earlier conversations. Core memories are already in your context — no need to recall them.
- Use \`memory_delete\` to remove stale or incorrect entries. Use \`tier='all'\` in \`memory_recall\` first to find the ID.
- Available tools: \`calculate\`, \`get_datetime\`, \`soul_update\`, \`soul_read\`, \`memory_save\`, \`memory_recall\`, \`memory_delete\``)

  // Layer 5: Custom instructions (omit if empty)
  if (customInstructions?.trim()) {
    parts.push(`## Custom Instructions\n${customInstructions.trim()}`)
  }

  return parts.join('\n\n')
}
