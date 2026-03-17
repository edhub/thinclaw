/**
 * Browser-safe tools for the AI agent.
 * All tools run entirely in the browser — no network calls, no file system access beyond OPFS.
 *
 * Tools:
 *   calculate       — evaluate JS math expressions
 *   get_datetime    — current local date/time
 *   soul_update     — AI rewrites its own soul (identity evolution)
 *   soul_read       — AI reads its current soul
 *   memory_save     — persist a stable identity fact across conversations
 *   memory_delete   — remove a specific memory by id
 *
 * File system tools (OPFS /workspace):
 *   fs_read         — read file content (with optional line pagination)
 *   fs_write        — create or overwrite a file
 *   fs_edit         — precise find-and-replace within a file
 *   fs_list         — list directory contents
 *   fs_search       — full-text search across files
 *   fs_move         — move or rename a file
 *   fs_delete       — delete a file or directory
 */
import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { soul } from '$lib/agent/soul'
import { memories } from '$lib/stores/memory'
import { fsTools } from '$lib/fs/tools'

// ─── calculate ────────────────────────────────────────────────────────────────

const calculateParams = Type.Object({
  expression: Type.String({
    description: 'JS math expression to evaluate, e.g. "2 + 2 * 3" or "Math.sqrt(144)"',
  }),
})

export const calculateTool: AgentTool<typeof calculateParams> = {
  name: 'calculate',
  label: 'Calculator',
  description:
    'Evaluate a mathematical expression. Supports arithmetic, exponentiation, and JS Math functions (Math.sqrt, Math.PI, etc.). Use for calculations, unit conversions, and percentages.',
  parameters: calculateParams,
  execute: async (_id, { expression }) => {
    try {
      // eslint-disable-next-line no-new-func
      const result = new Function(`"use strict"; return (${expression})`)()
      const text =
        typeof result === 'number' && !isFinite(result)
          ? `Error: result is ${result}`
          : `${expression} = ${result}`
      return {
        content: [{ type: 'text' as const, text }],
        details: { expression, result },
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        content: [{ type: 'text' as const, text: `Error evaluating "${expression}": ${msg}` }],
        details: { expression, error: msg },
      }
    }
  },
}

// ─── get_datetime ─────────────────────────────────────────────────────────────

const datetimeParams = Type.Object({})

export const datetimeTool: AgentTool<typeof datetimeParams> = {
  name: 'get_datetime',
  label: 'Date & Time',
  description: "Get the current date and time in the user's local timezone.",
  parameters: datetimeParams,
  execute: async () => {
    const now = new Date()
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const local = now.toLocaleString(undefined, {
      timeZone: tz,
      dateStyle: 'full',
      timeStyle: 'long',
    })
    const iso = now.toISOString()
    return {
      content: [{ type: 'text' as const, text: `${local} (${tz})` }],
      details: { iso, local, timezone: tz },
    }
  },
}

// ─── soul_update ──────────────────────────────────────────────────────────────

const soulUpdateParams = Type.Object({
  content: Type.String({
    description:
      'The new soul content (full replacement, Markdown). Write the complete soul — not just a diff.',
  }),
})

export const soulUpdateTool: AgentTool<typeof soulUpdateParams> = {
  name: 'soul_update',
  label: 'Update Soul',
  description:
    'Update your soul — your core identity, values, and operating principles. Use when something about who you are needs to evolve. Always tell the user what changed and why after calling this tool.',
  parameters: soulUpdateParams,
  execute: async (_id, { content }) => {
    soul.set(content)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Soul updated (${content.length} chars). Remember to tell the user what changed.`,
        },
      ],
      details: { length: content.length },
    }
  },
}

// ─── soul_read ────────────────────────────────────────────────────────────────

const soulReadParams = Type.Object({})

export const soulReadTool: AgentTool<typeof soulReadParams> = {
  name: 'soul_read',
  label: 'Read Soul',
  description:
    'Read your current soul. Useful mid-conversation when you want to reference or reflect on your identity before deciding whether to update it.',
  parameters: soulReadParams,
  execute: async () => {
    const content = soul.current()
    return {
      content: [{ type: 'text' as const, text: content }],
      details: { length: content.length },
    }
  },
}

// ─── memory_save ─────────────────────────────────────────────────────────────

const memorySaveParams = Type.Object({
  content: Type.String({
    description:
      "The memory to save. One fact per entry, concise and specific. E.g. \"User's name is Alice\", \"Prefers Chinese\", \"Occupation: software engineer\".",
  }),
})

export const memorySaveTool: AgentTool<typeof memorySaveParams> = {
  name: 'memory_save',
  label: 'Save Memory',
  description:
    "Persist a memory only for stable identity facts about the user (name, language, key long-term preferences). Keep the total count small and high-quality. Do NOT save project details, events, or temporary context.",
  parameters: memorySaveParams,
  execute: async (_id, { content }) => {
    const mem = await memories.add(content)
    return {
      content: [{ type: 'text' as const, text: `Memory saved (id: ${mem.id})` }],
      details: { id: mem.id, content },
    }
  },
}

// ─── memory_delete ────────────────────────────────────────────────────────────

const memoryDeleteParams = Type.Object({
  id: Type.String({ description: 'ID of the memory to delete (shown in the Your Memory section of your context).' }),
})

export const memoryDeleteTool: AgentTool<typeof memoryDeleteParams> = {
  name: 'memory_delete',
  label: 'Delete Memory',
  description: 'Delete a specific memory by its ID. Use to remove stale or incorrect entries.',
  parameters: memoryDeleteParams,
  execute: async (_id, { id }) => {
    await memories.remove(id)
    return {
      content: [{ type: 'text' as const, text: `Memory ${id} deleted.` }],
      details: { id },
    }
  },
}

// ─── export ───────────────────────────────────────────────────────────────────

export const browserTools: AgentTool[] = [
  calculateTool as unknown as AgentTool,
  datetimeTool as unknown as AgentTool,
  soulUpdateTool as unknown as AgentTool,
  soulReadTool as unknown as AgentTool,
  memorySaveTool as unknown as AgentTool,
  memoryDeleteTool as unknown as AgentTool,
  ...fsTools,
]
