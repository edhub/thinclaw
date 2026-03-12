/**
 * System prompt builder.
 *
 * The prompt is assembled from three layers:
 *   1. Soul       — the AI's identity (stored in localStorage, editable by the AI)
 *   2. Memory     — persistent facts saved across conversations (IndexedDB)
 *   3. Custom     — optional extra instructions from the user (Settings)
 *
 * There are no fixed "personas" anymore — the soul IS the identity.
 */
import type { Memory } from '$lib/db';

/**
 * Format a memory list into the block injected into the system prompt.
 * Returns an empty string when there are no memories.
 */
export function formatMemoriesForPrompt(mems: Memory[]): string {
  if (mems.length === 0) return '';
  return mems
    .map((m) => {
      const date = new Date(m.createdAt).toLocaleDateString('en-CA'); // YYYY-MM-DD
      return `- [${date}] ${m.content}`;
    })
    .join('\n');
}

/**
 * Assemble the full system prompt from soul + memories + custom instructions.
 *
 * @param soulContent    Current soul Markdown (from soul store).
 * @param memoriesText   Pre-formatted memory block (from formatMemoriesForPrompt).
 * @param customInstructions  Optional user-supplied extra instructions.
 */
export function buildSystemPrompt(
  soulContent: string,
  memoriesText: string,
  customInstructions?: string,
): string {
  const parts: string[] = [];

  // Layer 1: Soul
  parts.push(`## Your Soul\n${soulContent}`);

  // Layer 2: Memory (omit section if empty)
  if (memoriesText) {
    parts.push(`## Your Memory\n${memoriesText}`);
  }

  // Layer 3: How to operate (tool guidance)
  parts.push(`## How You Operate

- Your soul is your identity. When it needs to evolve, call \`soul_update\` with the full new content — then tell the user what changed and why.
- When the user shares something worth keeping (name, preferences, projects, context), call \`memory_save\`. Don't rely on conversation context alone; write it down.
- Use \`memory_recall\` to search past memories when you need context from earlier conversations.
- Use \`memory_delete\` to remove stale or wrong memories.
- Available tools: \`calculate\`, \`get_datetime\`, \`soul_update\`, \`soul_read\`, \`memory_save\`, \`memory_recall\`, \`memory_delete\``);

  // Layer 4: Custom instructions (omit if empty)
  if (customInstructions?.trim()) {
    parts.push(`## Custom Instructions\n${customInstructions.trim()}`);
  }

  return parts.join('\n\n');
}
