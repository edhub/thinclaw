/**
 * Browser-safe tools for the AI agent.
 * All tools run entirely in the browser — no network calls, no file system access beyond OPFS.
 *
 * Tools:
 *   run_js          — execute JS with full browser globals + injected `fs` object for OPFS
 *   memory_save     — persist a stable identity fact across conversations
 *   memory_delete   — remove a specific memory by id
 *
 * File system access is via the `fs` object inside run_js (no separate fs_* tools):
 *   fs.read / fs.write / fs.edit / fs.list / fs.search
 *   fs.stat / fs.move / fs.delete / fs.outline
 */
import { Type } from '@mariozechner/pi-ai'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { memories } from '$lib/stores/memory'
import {
  readFile,
  writeFile,
  editFile,
  listDir,
  searchFiles,
  statEntry,
  moveEntry,
  deleteEntry,
  outlineFile,
} from '$lib/fs/opfs'

// ─── OPFS context injected into run_js ────────────────────────────────────────

const fsContext = {
  read: readFile,
  write: writeFile,
  edit: editFile,
  list: listDir,
  search: searchFiles,
  stat: statEntry,
  move: moveEntry,
  delete: deleteEntry,
  outline: outlineFile,
}

// ─── run_js ───────────────────────────────────────────────────────────────────

const runJsParams = Type.Object({
  code: Type.String({
    description: [
      'JavaScript code to execute in an async function context. Use `return` to produce a result, `console.log()` to emit output. Supports `await` and all browser globals (Date, Math, fetch, crypto, …). 10-second timeout.',
      '',
      'OPFS workspace is available via the `fs` object:',
      '  fs.read(path, offset?, limit?) → {content, totalLines, returnedLines, truncated, offset}',
      '  fs.write(path, content) · fs.edit(path, oldText, newText) · fs.list(path)',
      '  fs.search(query, path?) · fs.stat(path) · fs.move(from, to) · fs.delete(path, recursive?)',
      '  fs.outline(path) — structural outline (headings / functions)',
      '',
      'Paths are workspace-relative ("notes/todo.md"). Prefix "tmp/" for temp files (7-day TTL).',
      'fs.read returns an object — use .content. Check .truncated and paginate with offset/limit for large files.',
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
    'Execute a JavaScript snippet in the browser. ' +
    'Has full access to browser globals (fetch, Date, Math, crypto, …) ' +
    'and a `fs` object for reading/writing the OPFS workspace. ' +
    'Use `return` to return a value; `console.log()` to emit output. Supports async/await.',
  parameters: runJsParams,
  execute: async (_id, { code }) => {
    const logs: string[] = []

    // Track which files are written/edited/moved during this invocation.
    const touchedFiles: string[] = []
    const trackedFs = {
      ...fsContext,
      write: async (path: string, content: string) => {
        const r = await fsContext.write(path, content)
        touchedFiles.push(path)
        return r
      },
      edit: async (path: string, oldText: string, newText: string) => {
        const r = await fsContext.edit(path, oldText, newText)
        touchedFiles.push(path)
        return r
      },
      move: async (from: string, to: string) => {
        const r = await fsContext.move(from, to)
        touchedFiles.push(to)
        return r
      },
    }

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
      // `fs` is injected as a parameter so code can call fs.read/write/edit/… directly.
      // eslint-disable-next-line no-new-func
      const fn = new Function('fs', `"use strict"; return (async () => { ${code} })()`)

      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Script timed out after ${TIMEOUT_MS / 1000} seconds`)),
          TIMEOUT_MS,
        ),
      )

      result = await Promise.race([fn(trackedFs) as Promise<unknown>, timeout])
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
      details: { result, logs, ...(touchedFiles.length > 0 ? { touchedFiles } : {}) },
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
  memorySaveTool,
  memoryDeleteTool,
]
