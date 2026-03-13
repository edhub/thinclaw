/**
 * File system tools for the AI agent, backed by OPFS.
 *
 * Storage layout:
 *   workspace/   — persistent files, AI's main working area
 *   tmp/         — temporary files, auto-deleted after 7 days (based on lastModified)
 *
 * All paths are relative to workspace root, except paths starting with "tmp/"
 * which route to the tmp area (e.g. "tmp/scratch.md").
 *
 * Tools:
 *   fs_read    — read file content (with optional line pagination)
 *   fs_write   — create or overwrite a file
 *   fs_edit    — precise find-and-replace within a file
 *   fs_list    — list directory contents
 *   fs_search  — full-text search across files
 *   fs_stat    — get file/directory metadata (size, lastModified, TTL)
 *   fs_move    — move or rename a file
 *   fs_delete  — delete a file or directory
 */
import { Type } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import {
  readFile,
  writeFile,
  editFile,
  listDir,
  searchFiles,
  statEntry,
  moveEntry,
  deleteEntry,
} from '$lib/fs/opfs';

// ─── fs_read ──────────────────────────────────────────────────────────────────

const fsReadParams = Type.Object({
  path: Type.String({
    description: 'File path relative to workspace root, e.g. "notes/daily.md"',
  }),
  offset: Type.Optional(
    Type.Number({
      description: 'Line number to start reading from (1-indexed). Omit to read from the start.',
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: 'Maximum number of lines to return. Omit to read the whole file.',
    }),
  ),
});

export const fsReadTool: AgentTool<typeof fsReadParams> = {
  name: 'fs_read',
  label: 'Read File',
  description:
    'Read the contents of a file in the workspace. ' +
    'For large files, use offset and limit to paginate (e.g. offset=1 limit=100, then offset=101 limit=100, etc.). ' +
    'Check the returned truncated field — if true, there is more content to read.',
  parameters: fsReadParams,
  execute: async (_id, { path, offset, limit }) => {
    try {
      const result = await readFile(path, offset, limit);
      const header =
        result.truncated
          ? `[Lines ${result.offset}–${result.offset + result.returnedLines - 1} of ${result.totalLines} total — truncated, continue with offset=${result.offset + result.returnedLines}]\n`
          : result.totalLines > result.returnedLines
          ? `[Lines ${result.offset}–${result.offset + result.returnedLines - 1} of ${result.totalLines} total]\n`
          : '';
      return {
        content: [{ type: 'text' as const, text: header + result.content }],
        details: result,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        details: { error: msg },
      };
    }
  },
};

// ─── fs_write ─────────────────────────────────────────────────────────────────

const fsWriteParams = Type.Object({
  path: Type.String({
    description: 'File path relative to workspace root, e.g. "notes/daily.md". Parent directories are created automatically.',
  }),
  content: Type.String({
    description: 'Full content to write. The file will be created or completely overwritten. Use fs_edit for partial changes.',
  }),
});

export const fsWriteTool: AgentTool<typeof fsWriteParams> = {
  name: 'fs_write',
  label: 'Write File',
  description:
    'Create a new file or completely overwrite an existing one. ' +
    'Parent directories are created automatically. ' +
    'Use this for new files or when rewriting the entire content. ' +
    'For small targeted edits to existing files, prefer fs_edit.',
  parameters: fsWriteParams,
  execute: async (_id, { path, content }) => {
    try {
      await writeFile(path, content);
      const lines = content.split('\n').length;
      return {
        content: [{ type: 'text' as const, text: `Written: ${path} (${content.length} chars, ${lines} lines)` }],
        details: { path, chars: content.length, lines },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        details: { error: msg },
      };
    }
  },
};

// ─── fs_edit ──────────────────────────────────────────────────────────────────

const fsEditParams = Type.Object({
  path: Type.String({
    description: 'File path relative to workspace root.',
  }),
  oldText: Type.String({
    description:
      'The exact text to find and replace. Must match the file content exactly, including whitespace and line breaks. Use fs_read first if unsure.',
  }),
  newText: Type.String({
    description: 'The replacement text.',
  }),
});

export const fsEditTool: AgentTool<typeof fsEditParams> = {
  name: 'fs_edit',
  label: 'Edit File',
  description:
    'Make a precise, surgical replacement in a file. ' +
    'oldText must match the existing file content exactly (whitespace matters). ' +
    'Replaces only the first occurrence. ' +
    'If unsure of the exact content, call fs_read first.',
  parameters: fsEditParams,
  execute: async (_id, { path, oldText, newText }) => {
    try {
      await editFile(path, oldText, newText);
      return {
        content: [{ type: 'text' as const, text: `Edited: ${path}` }],
        details: { path },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        details: { error: msg },
      };
    }
  },
};

// ─── fs_list ──────────────────────────────────────────────────────────────────

const fsListParams = Type.Object({
  path: Type.String({
    description: 'Directory path to list. Use "" or "/" for the workspace root.',
  }),
});

export const fsListTool: AgentTool<typeof fsListParams> = {
  name: 'fs_list',
  label: 'List Directory',
  description:
    'List the contents of a directory. ' +
    'Use "" to list the workspace root. ' +
    'Use "tmp" or "tmp/subdir" to list the tmp area. ' +
    'Returns file sizes and lastModified times. ' +
    'Tmp files also show ttlRemainingMs (negative = already expired, pending next sweep).',
  parameters: fsListParams,
  execute: async (_id, { path }) => {
    try {
      const entries = await listDir(path);
      if (entries.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `(empty directory)` }],
          details: { path, entries: [] },
        };
      }
      const lines = entries.map((e) => {
        if (e.kind === 'directory') return `${e.name}/`;
        const size = e.size !== undefined ? ` (${formatBytes(e.size)})` : '';
        return `${e.name}${size}`;
      });
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: { path, entries },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        details: { error: msg },
      };
    }
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── fs_search ────────────────────────────────────────────────────────────────

const fsSearchParams = Type.Object({
  query: Type.String({
    description: 'Text to search for (case-insensitive substring match).',
  }),
  path: Type.Optional(
    Type.String({
      description: 'Limit search to this directory (and subdirectories). Omit to search all of workspace.',
    }),
  ),
});

export const fsSearchTool: AgentTool<typeof fsSearchParams> = {
  name: 'fs_search',
  label: 'Search Files',
  description:
    'Search for text across files. Case-insensitive substring match. Returns up to 200 matches. ' +
    'Searches workspace only by default. ' +
    'To search tmp, pass path="tmp" or path="tmp/subdir". ' +
    'To search both, call this tool twice.',
  parameters: fsSearchParams,
  execute: async (_id, { query, path }) => {
    try {
      const matches = await searchFiles(query, path);
      if (matches.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No results for "${query}"` }],
          details: { query, count: 0 },
        };
      }
      const capped = matches.length >= 200;
      const lines = matches.map((m) => `${m.file}:${m.line}: ${m.text}`);
      const footer = capped ? '\n[Results capped at 200 — narrow your search or specify a path]' : '';
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') + footer }],
        details: { query, count: matches.length, capped },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        details: { error: msg },
      };
    }
  },
};

// ─── fs_stat ──────────────────────────────────────────────────────────────────

const fsStatParams = Type.Object({
  path: Type.String({
    description: 'File or directory path. Works for both workspace and tmp paths.',
  }),
});

export const fsStatTool: AgentTool<typeof fsStatParams> = {
  name: 'fs_stat',
  label: 'File Info',
  description:
    'Get metadata for a file or directory: kind, size (bytes), lastModified (ISO timestamp). ' +
    'For tmp files, also returns ttlRemainingMs — how many milliseconds until auto-deletion ' +
    '(negative means the file is already expired and will be removed on the next session).',
  parameters: fsStatParams,
  execute: async (_id, { path }) => {
    try {
      const stat = await statEntry(path);
      const lines: string[] = [`path: ${stat.path}`, `kind: ${stat.kind}`];
      if (stat.size !== undefined) lines.push(`size: ${formatBytes(stat.size)}`);
      if (stat.lastModifiedISO) lines.push(`lastModified: ${stat.lastModifiedISO}`);
      if (stat.ttlRemainingMs !== undefined) {
        const days = Math.abs(stat.ttlRemainingMs / 86_400_000).toFixed(1);
        lines.push(
          stat.ttlRemainingMs >= 0
            ? `ttl: expires in ${days} days`
            : `ttl: expired ${days} days ago (pending sweep)`,
        );
      }
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        details: stat,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        details: { error: msg },
      };
    }
  },
};

// ─── fs_move ──────────────────────────────────────────────────────────────────

const fsMoveParams = Type.Object({
  from: Type.String({
    description: 'Source file path relative to workspace root.',
  }),
  to: Type.String({
    description: 'Destination file path relative to workspace root. Parent directories are created automatically.',
  }),
});

export const fsMoveTool: AgentTool<typeof fsMoveParams> = {
  name: 'fs_move',
  label: 'Move / Rename File',
  description:
    'Move or rename a file. Works for files only (not directories). ' +
    'Supports both workspace and tmp paths — cross-root moves are allowed ' +
    '(e.g. from "tmp/draft.md" to "notes/draft.md"). ' +
    'Destination parent directories are created automatically.',
  parameters: fsMoveParams,
  execute: async (_id, { from, to }) => {
    try {
      await moveEntry(from, to);
      return {
        content: [{ type: 'text' as const, text: `Moved: ${from} → ${to}` }],
        details: { from, to },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        details: { error: msg },
      };
    }
  },
};

// ─── fs_delete ────────────────────────────────────────────────────────────────

const fsDeleteParams = Type.Object({
  path: Type.String({
    description: 'Path of the file or directory to delete.',
  }),
  recursive: Type.Optional(
    Type.Boolean({
      description: 'Required to delete a non-empty directory. Defaults to false.',
    }),
  ),
});

export const fsDeleteTool: AgentTool<typeof fsDeleteParams> = {
  name: 'fs_delete',
  label: 'Delete File / Directory',
  description:
    'Delete a file or directory from the workspace. ' +
    'To delete a non-empty directory, pass recursive=true. ' +
    'This operation is permanent — there is no trash or undo.',
  parameters: fsDeleteParams,
  execute: async (_id, { path, recursive }) => {
    try {
      await deleteEntry(path, recursive ?? false);
      return {
        content: [{ type: 'text' as const, text: `Deleted: ${path}` }],
        details: { path, recursive: recursive ?? false },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: 'text' as const, text: `Error: ${msg}` }],
        details: { error: msg },
      };
    }
  },
};

// ─── export ───────────────────────────────────────────────────────────────────

export const fsTools: AgentTool[] = [
  fsReadTool as unknown as AgentTool,
  fsWriteTool as unknown as AgentTool,
  fsEditTool as unknown as AgentTool,
  fsListTool as unknown as AgentTool,
  fsSearchTool as unknown as AgentTool,
  fsStatTool as unknown as AgentTool,
  fsMoveTool as unknown as AgentTool,
  fsDeleteTool as unknown as AgentTool,
];
