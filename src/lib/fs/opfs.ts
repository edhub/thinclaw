/**
 * OPFS (Origin Private File System) abstraction layer.
 *
 * Storage layout (OPFS root):
 *   workspace/   — persistent files, AI's main working area
 *   tmp/         — temporary files, auto-swept after 7 days (per lastModified)
 *
 * All paths passed in are resolved against one of the two roots:
 *   - Paths starting with "tmp/" (or equal to "tmp") → tmp root
 *   - All other paths → workspace root
 *
 * Within each root, paths are relative: "notes/daily.md", "tmp/scratch.md", etc.
 * Leading slashes and "./" are stripped; ".." segments are rejected.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKSPACE_NAME = 'workspace'
const TMP_NAME = 'tmp'
const TMP_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ─── Path utilities ────────────────────────────────────────────────────────────

/**
 * Normalize a user-supplied path into clean segments.
 * Throws if the path attempts to escape the root (via ..).
 */
function parsePath(path: string): string[] {
  const segments = path
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '.')

  for (const seg of segments) {
    if (seg === '..') {
      throw new Error(`Invalid path: "${path}" — ".." segments are not allowed`)
    }
    if (seg.includes('\0')) {
      throw new Error(`Invalid path: contains null bytes`)
    }
  }
  return segments
}

// ─── Root resolution ──────────────────────────────────────────────────────────

type RootResolution = {
  root: FileSystemDirectoryHandle
  segments: string[] // path segments relative to root (tmp prefix stripped)
  isTmp: boolean
}

/**
 * Resolve a user path to the appropriate OPFS root handle and remaining segments.
 * Paths starting with "tmp" route to the tmp root; everything else goes to workspace.
 * Accessing tmp also triggers the one-per-session lazy sweep.
 */
async function resolveRoot(path: string): Promise<RootResolution> {
  const all = parsePath(path)
  if (all.length > 0 && all[0] === TMP_NAME) {
    await maybeSweepTmp()
    return { root: await getTmpRoot(), segments: all.slice(1), isTmp: true }
  }
  return { root: await getWorkspace(), segments: all, isTmp: false }
}

// ─── OPFS root handles ────────────────────────────────────────────────────────

async function getWorkspace(): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory()
  return opfsRoot.getDirectoryHandle(WORKSPACE_NAME, { create: true })
}

async function getTmpRoot(): Promise<FileSystemDirectoryHandle> {
  const opfsRoot = await navigator.storage.getDirectory()
  return opfsRoot.getDirectoryHandle(TMP_NAME, { create: true })
}

// ─── Tmp sweep ────────────────────────────────────────────────────────────────

// Only sweep once per browser session, regardless of how many tmp calls are made.
let tmpSweptThisSession = false

async function maybeSweepTmp(): Promise<void> {
  if (tmpSweptThisSession) return
  tmpSweptThisSession = true
  try {
    await sweepDir(await getTmpRoot(), Date.now() - TMP_TTL_MS)
  } catch {
    // Sweep failures are non-fatal — tmp access continues normally.
  }
}

/** Recursively delete files whose lastModified is older than cutoff.
 *  Returns true if the directory is empty after sweeping (safe for caller to remove). */
async function sweepDir(dir: FileSystemDirectoryHandle, cutoff: number): Promise<boolean> {
  let totalEntries = 0
  const toDelete: string[] = []

  for await (const [name, handle] of dir.entries()) {
    totalEntries++
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile()
      if (file.lastModified < cutoff) toDelete.push(name)
    } else {
      const childEmpty = await sweepDir(handle as FileSystemDirectoryHandle, cutoff)
      if (childEmpty) toDelete.push(name)
    }
  }

  let deleted = 0
  for (const name of toDelete) {
    try {
      await dir.removeEntry(name)
      deleted++
    } catch {
      // Ignore individual delete failures during sweep.
    }
  }

  // Directory is empty (and removable) if every entry was successfully deleted.
  return deleted === totalEntries
}

// ─── Handle traversal ─────────────────────────────────────────────────────────

async function getDirHandle(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg, { create })
  }
  return dir
}

async function getFileHandle(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create = false,
): Promise<FileSystemFileHandle> {
  if (segments.length === 0) throw new Error('Path must point to a file, not a directory')
  const dir = await getDirHandle(root, segments.slice(0, -1), create)
  return dir.getFileHandle(segments[segments.length - 1], { create })
}

// ─── fs_read ──────────────────────────────────────────────────────────────────

export interface ReadResult {
  content: string
  totalLines: number
  returnedLines: number
  truncated: boolean
  offset: number
}

/**
 * Read file content with optional line-based pagination.
 * offset is 1-indexed. Omit offset/limit to read the entire file.
 */
export async function readFile(path: string, offset?: number, limit?: number): Promise<ReadResult> {
  const { root, segments } = await resolveRoot(path)
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await getFileHandle(root, segments, false)
  } catch {
    throw new Error(`File not found: ${path}`)
  }

  const file = await fileHandle.getFile()
  const text = await file.text()
  const allLines = text.split('\n')
  const totalLines = allLines.length

  const startLine = Math.max(1, offset ?? 1)
  const startIdx = startLine - 1
  const slice =
    limit !== undefined ? allLines.slice(startIdx, startIdx + limit) : allLines.slice(startIdx)

  return {
    content: slice.join('\n'),
    totalLines,
    returnedLines: slice.length,
    truncated: startIdx + slice.length < totalLines,
    offset: startLine,
  }
}

// ─── fs_stat ──────────────────────────────────────────────────────────────────

export interface StatResult {
  path: string
  kind: 'file' | 'directory'
  /** Bytes. Only present for files. */
  size?: number
  /** Unix ms. Only present for files (directories have no lastModified in OPFS). */
  lastModified?: number
  lastModifiedISO?: string
  /** For tmp files: ms remaining before TTL expiry. Negative = already expired (pending sweep). */
  ttlRemainingMs?: number
}

/**
 * Return metadata about a file or directory.
 * For tmp files, also returns TTL info.
 */
export async function statEntry(path: string): Promise<StatResult> {
  const { root, segments, isTmp } = await resolveRoot(path)

  // Try file first, then directory
  try {
    const fh = await getFileHandle(root, segments, false)
    const file = await fh.getFile()
    const result: StatResult = {
      path,
      kind: 'file',
      size: file.size,
      lastModified: file.lastModified,
      lastModifiedISO: new Date(file.lastModified).toISOString(),
    }
    if (isTmp) {
      result.ttlRemainingMs = file.lastModified + TMP_TTL_MS - Date.now()
    }
    return result
  } catch {
    // Not a file — try as directory
  }

  try {
    await getDirHandle(root, segments, false)
    return { path, kind: 'directory' }
  } catch {
    throw new Error(`Not found: ${path}`)
  }
}

// ─── fs_write ─────────────────────────────────────────────────────────────────

export async function writeFile(path: string, content: string): Promise<void> {
  const { root, segments } = await resolveRoot(path)
  if (segments.length === 0) throw new Error('Path must point to a file')
  const fileHandle = await getFileHandle(root, segments, true)
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

// ─── fs_edit ──────────────────────────────────────────────────────────────────

export interface EditResult {
  replacements: number
}

export async function editFile(
  path: string,
  oldText: string,
  newText: string,
): Promise<EditResult> {
  const { root, segments } = await resolveRoot(path)
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await getFileHandle(root, segments, false)
  } catch {
    throw new Error(`File not found: ${path}`)
  }

  const file = await fileHandle.getFile()
  const original = await file.text()

  if (!original.includes(oldText)) {
    throw new Error(
      `edit failed: oldText not found in ${path}. ` +
        `Make sure the text matches exactly (including whitespace).`,
    )
  }

  const updated = original.replace(oldText, newText)
  const writable = await fileHandle.createWritable()
  await writable.write(updated)
  await writable.close()

  return { replacements: 1 }
}

// ─── fs_list ──────────────────────────────────────────────────────────────────

export interface ListEntry {
  name: string
  kind: 'file' | 'directory'
  size?: number
  lastModified?: number
  /** Only present for tmp files. */
  ttlRemainingMs?: number
}

export async function listDir(path: string): Promise<ListEntry[]> {
  const { root, segments, isTmp } = await resolveRoot(path)

  let dir: FileSystemDirectoryHandle
  try {
    dir = await getDirHandle(root, segments, false)
  } catch {
    throw new Error(`Directory not found: ${path}`)
  }

  const entries: ListEntry[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') {
      const file = await (handle as FileSystemFileHandle).getFile()
      const entry: ListEntry = {
        name,
        kind: 'file',
        size: file.size,
        lastModified: file.lastModified,
      }
      if (isTmp) {
        entry.ttlRemainingMs = file.lastModified + TMP_TTL_MS - Date.now()
      }
      entries.push(entry)
    } else {
      entries.push({ name, kind: 'directory' })
    }
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return entries
}

// ─── fs_search ────────────────────────────────────────────────────────────────

export interface SearchMatch {
  file: string
  line: number
  text: string
}

export async function searchFiles(query: string, searchPath = ''): Promise<SearchMatch[]> {
  const lowerQuery = query.toLowerCase()
  const results: SearchMatch[] = []
  const { root, segments, isTmp } = await resolveRoot(searchPath)

  // ── Single-file mode (grep within one file) ───────────────────────────────
  // If the path resolves to a file rather than a directory, search only that file.
  if (segments.length > 0) {
    try {
      const fh = await getFileHandle(root, segments, false)
      const fileName = segments[segments.length - 1]
      if (!isTextFile(fileName)) return []
      const file = await fh.getFile()
      const text = await file.text()
      const lines = text.split('\n')
      const displayPath = isTmp ? `tmp/${segments.join('/')}` : segments.join('/')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(lowerQuery)) {
          results.push({ file: displayPath, line: i + 1, text: lines[i].trim() })
          if (results.length >= 200) break
        }
      }
      return results
    } catch {
      // Not a file — fall through to directory search.
    }
  }

  // ── Directory mode (recursive walk) ──────────────────────────────────────
  let rootDir: FileSystemDirectoryHandle
  try {
    rootDir = await getDirHandle(root, segments, false)
  } catch {
    throw new Error(`Search path not found: ${searchPath}`)
  }

  // Display prefix for result paths
  const pathPrefix = isTmp
    ? segments.length > 0
      ? `tmp/${segments.join('/')}`
      : 'tmp'
    : segments.join('/')

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    for await (const [name, handle] of dir.entries()) {
      const filePath = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory') {
        await walk(handle as FileSystemDirectoryHandle, filePath)
      } else {
        if (!isTextFile(name)) continue
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          const text = await file.text()
          const lines = text.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(lowerQuery)) {
              results.push({ file: filePath, line: i + 1, text: lines[i].trim() })
              if (results.length >= 200) return
            }
          }
        } catch {
          // Skip unreadable files silently.
        }
      }
    }
  }

  await walk(rootDir, pathPrefix)
  return results
}

function isTextFile(name: string): boolean {
  const textExts = [
    '.md',
    '.txt',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.csv',
    '.html',
    '.xml',
    '.ts',
    '.js',
    '.css',
    '.sh',
  ]
  const lower = name.toLowerCase()
  return textExts.some((ext) => lower.endsWith(ext))
}

// ─── fs_move ──────────────────────────────────────────────────────────────────

export async function moveEntry(from: string, to: string): Promise<void> {
  const { root: fromRoot, segments: fromSegs } = await resolveRoot(from)
  if (fromSegs.length === 0) throw new Error('Source must be a file path')

  let srcHandle: FileSystemFileHandle
  try {
    srcHandle = await getFileHandle(fromRoot, fromSegs, false)
  } catch {
    throw new Error(`Source not found: ${from}`)
  }

  const srcFile = await srcHandle.getFile()
  const content = await srcFile.text()

  await writeFile(to, content)

  const srcParentDir = await getDirHandle(fromRoot, fromSegs.slice(0, -1), false)
  await srcParentDir.removeEntry(fromSegs[fromSegs.length - 1])
}

// ─── fs_delete ────────────────────────────────────────────────────────────────

export async function deleteEntry(path: string, recursive = false): Promise<void> {
  const { root, segments } = await resolveRoot(path)
  if (segments.length === 0) throw new Error('Cannot delete a root directory')

  const parentDir = await getDirHandle(root, segments.slice(0, -1), false)
  const name = segments[segments.length - 1]

  try {
    await parentDir.removeEntry(name, { recursive })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('non-empty') || msg.includes('directory')) {
      throw new Error(
        `Cannot delete "${path}": it is a non-empty directory. ` +
          `Pass recursive=true to delete it and all its contents.`,
      )
    }
    throw new Error(`Delete failed: ${msg}`)
  }
}

// ─── fs_outline ───────────────────────────────────────────────────────────────

export interface OutlineEntry {
  /** 1-indexed line number. */
  line: number
  /** The structural marker text (heading, function signature, etc.). */
  text: string
}

/**
 * Extract a structural outline from a file.
 *
 * Supported file types and what is extracted:
 *   .md / .markdown  — headings (#, ##, ###, …)
 *   .ts / .js / .tsx / .jsx / .svelte / .mjs / .cjs
 *                    — exported declarations, functions, classes
 *   .py              — def / async def / class
 *
 * Returns an empty array for unrecognised file types (not an error).
 */
export async function outlineFile(path: string): Promise<OutlineEntry[]> {
  const { root, segments } = await resolveRoot(path)
  let fileHandle: FileSystemFileHandle
  try {
    fileHandle = await getFileHandle(root, segments, false)
  } catch {
    throw new Error(`File not found: ${path}`)
  }

  const file = await fileHandle.getFile()
  const text = await file.text()
  const lines = text.split('\n')
  const ext = (segments[segments.length - 1] ?? '').split('.').pop()?.toLowerCase() ?? ''
  return extractOutline(lines, ext)
}

function extractOutline(lines: string[], ext: string): OutlineEntry[] {
  const entries: OutlineEntry[] = []

  if (ext === 'md' || ext === 'markdown') {
    for (let i = 0; i < lines.length; i++) {
      if (/^#{1,6}\s/.test(lines[i])) {
        entries.push({ line: i + 1, text: lines[i].trim() })
      }
    }
  } else if (['ts', 'js', 'tsx', 'jsx', 'svelte', 'mjs', 'cjs'].includes(ext)) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim()
      // Match exported/top-level functions, classes, type aliases, interfaces, enums.
      if (
        /^(export\s+)?(default\s+)?(async\s+)?function[\s*]\s*\w+/.test(l) ||
        /^(export\s+)?(abstract\s+)?class\s+\w+/.test(l) ||
        /^export\s+(const|let|type|interface|enum)\s+\w+/.test(l) ||
        /^(export\s+)?default\s+(class|function)\b/.test(l)
      ) {
        entries.push({ line: i + 1, text: l.slice(0, 120) })
      }
    }
  } else if (ext === 'py') {
    for (let i = 0; i < lines.length; i++) {
      if (/^(async\s+)?def\s+\w+|^class\s+\w+/.test(lines[i].trim())) {
        entries.push({ line: i + 1, text: lines[i].trim().slice(0, 120) })
      }
    }
  }
  // Other types: return empty (the tool will report "no markers found").

  return entries
}
