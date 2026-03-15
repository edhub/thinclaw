/**
 * Session recorder — writes conversation sessions to OPFS sessions/ directory.
 *
 * Storage layout:
 *   OPFS root / sessions / {convId}.jsonl
 *
 * Format: JSONL — one JSON object per line.
 *   Line 1:  SessionHeader  (metadata, updated on every write)
 *   Lines 2+: SessionMessageEntry  (one per AgentMessage)
 *
 * TTL: 7 days based on file lastModified (= timestamp of last agent_end for
 *      that conversation). Sweep runs once per browser session on first access.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSIONS_DIR = 'sessions'
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ─── Entry types ──────────────────────────────────────────────────────────────

/** Serialisable subset of AgentTool (strips the non-serialisable execute fn). */
export interface SerializedTool {
  name: string
  description: string
  /** TypeBox schema object describing the tool's input parameters. */
  parameters: unknown
}

export interface SessionHeader {
  type: 'session'
  conversationId: string
  conversationTitle: string
  /** Unix ms — when the conversation was first created. */
  createdAt: number
  /** ISO timestamp — updated on every write (= last agent_end time). */
  timestamp: string
  model: string
  /** Thinking/reasoning level active at last agent_end. */
  thinkingLevel: string
  /** Persona ID if one was selected for this conversation. */
  personaId?: string
  /** Full system prompt active at the time of the last agent_end. */
  systemPrompt: string
  /** Tool definitions active at the time of the last agent_end. */
  tools?: SerializedTool[]
}

export interface SessionMessageEntry {
  type: 'message'
  message: AgentMessage
}

/**
 * Captured LLM request payload for debugging prompt caching and prefix stability.
 * Contains the full Anthropic/Google params object as sent to the provider.
 */
export interface SessionPayloadEntry {
  type: 'payload'
  /** Unix ms — when the LLM call was initiated. */
  timestamp: number
  /** Full provider request params (messages, system, tools, thinking, etc.). */
  params: Record<string, unknown>
}

export type SessionEntry = SessionHeader | SessionMessageEntry | SessionPayloadEntry

// ─── OPFS helpers ─────────────────────────────────────────────────────────────

async function getSessionsDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(SESSIONS_DIR, { create: true })
}

// ─── TTL sweep ────────────────────────────────────────────────────────────────

let sweptThisSession = false

/**
 * Delete session files whose lastModified is older than SESSION_TTL_MS.
 * No-ops after the first call per browser session.
 */
export async function sweepSessions(): Promise<void> {
  if (sweptThisSession) return
  sweptThisSession = true
  try {
    const dir = await getSessionsDir()
    const cutoff = Date.now() - SESSION_TTL_MS
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file') continue
      const file = await (handle as FileSystemFileHandle).getFile()
      if (file.lastModified < cutoff) {
        try {
          await dir.removeEntry(name)
        } catch {
          // Ignore individual delete failures.
        }
      }
    }
  } catch {
    // Non-fatal — sweep failures don't affect normal operation.
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Write (or overwrite) the session file for a conversation.
 * Should be called after each agent_end with the complete current message list.
 * The file's lastModified timestamp becomes the TTL anchor.
 */
export async function recordSession(
  convId: string,
  title: string,
  createdAt: number,
  model: string,
  thinkingLevel: string,
  personaId: string | undefined,
  systemPrompt: string,
  messages: AgentMessage[],
  tools?: SerializedTool[],
  payloads?: SessionPayloadEntry[],
): Promise<void> {
  await sweepSessions() // lazy sweep before first write

  const header: SessionHeader = {
    type: 'session',
    conversationId: convId,
    conversationTitle: title,
    createdAt,
    timestamp: new Date().toISOString(),
    model,
    thinkingLevel,
    ...(personaId ? { personaId } : {}),
    systemPrompt,
    ...(tools && tools.length > 0 ? { tools } : {}),
  }

  const lines = [
    JSON.stringify(header),
    ...messages.map((msg) =>
      JSON.stringify({ type: 'message', message: msg } satisfies SessionMessageEntry),
    ),
    ...(payloads ?? []).map((p) => JSON.stringify(p)),
  ]

  const dir = await getSessionsDir()
  const fileHandle = await dir.getFileHandle(`${convId}.jsonl`, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(lines.join('\n'))
  await writable.close()
}

/**
 * Update only the conversationTitle in an existing session file's header line.
 * If no session file exists for this conversation yet, does nothing (the next
 * full recordSession call will use the correct title).
 */
export async function updateSessionTitle(convId: string, title: string): Promise<void> {
  try {
    const dir = await getSessionsDir()
    let fileHandle: FileSystemFileHandle
    try {
      fileHandle = await dir.getFileHandle(`${convId}.jsonl`)
    } catch {
      return // No session file yet — nothing to update.
    }

    const file = await fileHandle.getFile()
    const text = await file.text()
    const lines = text.split('\n')
    if (lines.length === 0) return

    // Parse and patch the header line (line 0).
    let header: Record<string, unknown>
    try {
      header = JSON.parse(lines[0])
    } catch {
      return // Malformed header — leave file untouched.
    }
    header.conversationTitle = title
    lines[0] = JSON.stringify(header)

    const writable = await fileHandle.createWritable()
    await writable.write(lines.join('\n'))
    await writable.close()
  } catch {
    // Non-fatal — title update failures are silently ignored.
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface SessionListItem {
  convId: string
  /** Conversation title read from the header line of the JSONL file. */
  title: string
  lastModified: number
  size: number
}

/**
 * List all session files, reading each header line for the conversation title.
 * Returns newest-first.
 */
export async function listSessions(): Promise<SessionListItem[]> {
  try {
    await sweepSessions()
    const dir = await getSessionsDir()
    const result: SessionListItem[] = []

    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.jsonl')) continue
      const file = await (handle as FileSystemFileHandle).getFile()
      const text = await file.text()
      const firstLine = text.split('\n')[0] ?? ''
      let title = name.replace(/\.jsonl$/, '')
      try {
        const hdr = JSON.parse(firstLine) as Partial<SessionHeader>
        if (hdr.conversationTitle) title = hdr.conversationTitle
      } catch {
        // Malformed header — fall back to filename.
      }
      result.push({
        convId: name.replace(/\.jsonl$/, ''),
        title,
        lastModified: file.lastModified,
        size: file.size,
      })
    }

    return result.sort((a, b) => b.lastModified - a.lastModified)
  } catch {
    return []
  }
}

// ─── Read / parse ─────────────────────────────────────────────────────────────

/** Read the raw JSONL text for a session by conversation ID. */
export async function readSessionFile(convId: string): Promise<string> {
  const dir = await getSessionsDir()
  const fileHandle = await dir.getFileHandle(`${convId}.jsonl`)
  const file = await fileHandle.getFile()
  return file.text()
}

/** Parse raw JSONL text into an array of typed session entries. */
export function parseSessionJsonl(content: string): SessionEntry[] {
  const entries: SessionEntry[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      entries.push(JSON.parse(trimmed) as SessionEntry)
    } catch {
      // Skip malformed lines silently.
    }
  }
  return entries
}
