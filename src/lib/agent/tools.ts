/**
 * Browser-safe tools for the AI agent.
 * All tools run entirely in the browser — no network calls, no file system access beyond OPFS.
 *
 * Tools:
 *   run_js          — write and execute an arbitrary JS snippet (replaces calculate + get_datetime)
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
import { memories } from '$lib/stores/memory'
import { fsTools } from '$lib/fs/tools'

// ─── run_js ───────────────────────────────────────────────────────────────────

const runJsParams = Type.Object({
  code: Type.String({
    description: [
      'JavaScript code to execute in an async function context.',
      'Use `return` to produce a result value.',
      'Use `console.log()` / `console.error()` etc. to emit output lines.',
      'Supports `await`. Has access to all standard browser globals (Date, Math, fetch, crypto, …).',
      'Execution is time-limited to 10 seconds.',
      'Examples:',
      '  • Get current time:  return new Date().toLocaleString()',
      '  • Calculate:        const r = Math.sqrt(144); return `sqrt(144) = ${r}`',
      '  • Async work:       const d = await fetch("https://…").then(r=>r.json()); return d',
    ].join('\n'),
  }),
})

type ConsoleMethods = 'log' | 'info' | 'warn' | 'error' | 'debug'
const CONSOLE_METHODS: ConsoleMethods[] = ['log', 'info', 'warn', 'error', 'debug']
const TIMEOUT_MS = 10_000

function serialize(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export const runJsTool: AgentTool<typeof runJsParams> = {
  name: 'run_js',
  label: 'Run JS',
  description:
    'Write and execute a JavaScript snippet in the browser. Useful for calculations, date/time queries, string manipulation, data transformation, quick API calls, and anything else expressible in JS. Supports async/await. Use `return` to return a value; use `console.log()` to emit output.',
  parameters: runJsParams,
  execute: async (_id, { code }) => {
    const logs: string[] = []

    // Temporarily redirect console output so we can capture it.
    const originals = {} as Record<ConsoleMethods, (...a: unknown[]) => void>
    for (const method of CONSOLE_METHODS) {
      originals[method] = console[method].bind(console)
      ;(console as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        const line = `[${method}] ${args.map(serialize).join(' ')}`
        logs.push(line)
        originals[method](...args) // still emit to devtools
      }
    }

    let result: unknown
    let errorMsg: string | undefined

    try {
      // Wrap in async IIFE so `await` and `return` both work naturally.
      // eslint-disable-next-line no-new-func
      const fn = new Function(`"use strict"; return (async () => { ${code} })()`)

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Script timed out after ${TIMEOUT_MS / 1000} seconds`)),
          TIMEOUT_MS,
        ),
      )

      result = await Promise.race([fn() as Promise<unknown>, timeout])
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e)
    } finally {
      // Always restore console.
      for (const method of CONSOLE_METHODS) {
        ;(console as unknown as Record<string, unknown>)[method] = originals[method]
      }
    }

    if (errorMsg !== undefined) {
      const text = logs.length > 0 ? `${logs.join('\n')}\nError: ${errorMsg}` : `Error: ${errorMsg}`
      return {
        content: [{ type: 'text' as const, text }],
        details: { error: errorMsg, logs },
      }
    }

    const parts: string[] = []
    if (logs.length > 0) parts.push(logs.join('\n'))
    if (result !== undefined) parts.push(`=> ${serialize(result)}`)

    const text = parts.length > 0 ? parts.join('\n') : '(no output)'
    return {
      content: [{ type: 'text' as const, text }],
      details: { result, logs },
    }
  },
}

// ─── memory_save ─────────────────────────────────────────────────────────────

const memorySaveParams = Type.Object({
  content: Type.String({
    description:
      'The memory to save. One fact per entry, concise and specific. E.g. "User\'s name is Alice", "Prefers Chinese", "Occupation: software engineer".',
  }),
})

export const memorySaveTool: AgentTool<typeof memorySaveParams> = {
  name: 'memory_save',
  label: 'Save Memory',
  description:
    'Persist a memory only for stable identity facts about the user (name, language, key long-term preferences). Keep the total count small and high-quality. Do NOT save project details, events, or temporary context.',
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
  id: Type.String({
    description: 'ID of the memory to delete (shown in the Your Memory section of your context).',
  }),
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

export const browserTools: AgentTool<any>[] = [
  runJsTool,
  // soulUpdateTool,
  // soulReadTool,
  memorySaveTool,
  memoryDeleteTool,
  ...fsTools,
]
