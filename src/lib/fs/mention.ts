/**
 * Utilities for the @mention file picker in ChatInput.
 *
 * Provides:
 *   listWorkspaceFiles  — recursive file listing (skips tmp/)
 *   fuzzyFilter         — relevance-ranked substring match (≤10 results)
 *   getFilePreview      — first N lines for context injection
 */
import { listDir, readFile } from '$lib/fs/opfs'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileEntry {
  /** Path relative to workspace root, e.g. "notes/todo.md" */
  path: string
  /** Filename only, e.g. "todo.md" */
  name: string
}

export interface FilePreview {
  content: string
  totalLines: number
  /** True when the file has more lines beyond what was returned. */
  truncated: boolean
}

// ─── File listing ─────────────────────────────────────────────────────────────

/**
 * List all files in the workspace recursively.
 * The tmp/ directory is intentionally excluded — users reference workspace files.
 */
export async function listWorkspaceFiles(): Promise<FileEntry[]> {
  const results: FileEntry[] = []
  await walkDir('', results)
  return results
}

async function walkDir(dir: string, results: FileEntry[]): Promise<void> {
  try {
    const entries = await listDir(dir)
    for (const entry of entries) {
      const fullPath = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        // Skip tmp/ at the workspace root — it's AI scratch space, not user content.
        if (entry.name === 'tmp' && dir === '') continue
        await walkDir(fullPath, results)
      } else {
        results.push({ path: fullPath, name: entry.name })
      }
    }
  } catch {
    // Workspace may be empty or missing — treat as no files.
  }
}

// ─── Fuzzy filter ─────────────────────────────────────────────────────────────

/**
 * Filter and rank files by query string.
 *
 * Scoring (highest first):
 *   100 — exact filename match
 *    80 — filename starts with query
 *    60 — filename contains query
 *    40 — full path contains query
 *
 * Returns at most 10 results.
 */
export function fuzzyFilter(files: FileEntry[], query: string): FileEntry[] {
  if (!query) return files.slice(0, 10)
  const q = query.toLowerCase()
  type Scored = { file: FileEntry; score: number }
  const scored: Scored[] = []
  for (const f of files) {
    const name = f.name.toLowerCase()
    const path = f.path.toLowerCase()
    let score = 0
    if (name === q) score = 100
    else if (name.startsWith(q)) score = 80
    else if (name.includes(q)) score = 60
    else if (path.includes(q)) score = 40
    else continue
    scored.push({ file: f, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 10).map((s) => s.file)
}

// ─── Preview ──────────────────────────────────────────────────────────────────

/**
 * Read the first `maxLines` lines of a file for @mention context injection.
 */
export async function getFilePreview(path: string, maxLines = 20): Promise<FilePreview> {
  const result = await readFile(path, 1, maxLines)
  return {
    content: result.content,
    totalLines: result.totalLines,
    truncated: result.truncated,
  }
}
