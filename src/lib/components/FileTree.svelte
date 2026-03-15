<!--
  FileTree — self-contained sidebar for OPFS workspace/tmp tree + session list.
  Manages its own tree state; parent only needs to handle file/session open events.
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { listDir } from '$lib/fs/opfs'
  import type { ListEntry } from '$lib/fs/opfs'
  import { listSessions, type SessionListItem } from '$lib/fs/session-recorder'

  interface Props {
    selectedPath: string | null
    onOpenFile: (path: string) => void
    onOpenSession: (convId: string) => void
    open?: boolean
    onClose?: () => void
  }
  let { selectedPath, onOpenFile, onOpenSession, open = false, onClose }: Props = $props()

  // ─── Types ────────────────────────────────────────────────────────────────

  interface TreeNode {
    name: string
    path: string
    kind: 'file' | 'directory'
    /** undefined = file (n/a), null = dir not yet loaded, array = loaded */
    children?: TreeNode[] | null
    expanded: boolean
  }

  // ─── State ────────────────────────────────────────────────────────────────

  let workspaceTree = $state<TreeNode[]>([])
  let tmpTree = $state<TreeNode[]>([])
  let sessionsList = $state<SessionListItem[]>([])

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function toNodes(entries: ListEntry[], parentPath: string): TreeNode[] {
    return entries
      .map((e) => ({
        name: e.name,
        path: parentPath ? `${parentPath}/${e.name}` : e.name,
        kind: e.kind,
        children: e.kind === 'directory' ? null : undefined,
        expanded: false,
      }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  async function expandDir(node: TreeNode): Promise<void> {
    if (node.kind !== 'directory') return
    if (node.children === null || node.children === undefined) {
      const entries = await listDir(node.path)
      node.children = toNodes(entries, node.path)
    }
    node.expanded = !node.expanded
  }

  // ─── Public API (via bind:this) ───────────────────────────────────────────

  /** Expand all ancestor directories of `path` so the file is visible in the tree. */
  export async function expandToPath(path: string): Promise<void> {
    const isTmp = path.startsWith('tmp/') || path === 'tmp'
    const parts = isTmp ? path.split('/').slice(1) : path.split('/')
    let nodes = isTmp ? tmpTree : workspaceTree
    for (let i = 0; i < parts.length - 1; i++) {
      const node = nodes.find((n) => n.name === parts[i] && n.kind === 'directory')
      if (!node) break
      if (node.children === null || node.children === undefined) {
        node.children = toNodes(await listDir(node.path), node.path)
      }
      node.expanded = true
      nodes = node.children ?? []
    }
  }

  /** Reload all three sections (workspace, tmp, sessions). */
  export async function refresh(): Promise<void> {
    const [ws, tmp, sessions] = await Promise.allSettled([
      listDir(''),
      listDir('tmp'),
      listSessions(),
    ])
    if (ws.status === 'fulfilled') workspaceTree = toNodes(ws.value, '')
    if (tmp.status === 'fulfilled') tmpTree = toNodes(tmp.value, 'tmp')
    if (sessions.status === 'fulfilled') sessionsList = sessions.value
  }

  onMount(refresh)
</script>

<aside class="sidebar" class:mobile-open={open}>
  <div class="header">
    <span class="title">Files</span>
    <button class="btn-refresh" onclick={refresh} title="Refresh">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
      </svg>
    </button>
  </div>

  <div class="tree">
    <div class="section-label">workspace</div>
    {#if workspaceTree.length === 0}
      <div class="empty">empty</div>
    {:else}
      {#each workspaceTree as node}
        {@render treeNode(node, 0)}
      {/each}
    {/if}

    <div class="section-label gap">tmp</div>
    {#if tmpTree.length === 0}
      <div class="empty">empty</div>
    {:else}
      {#each tmpTree as node}
        {@render treeNode(node, 0)}
      {/each}
    {/if}

    <div class="section-label gap">sessions</div>
    {#if sessionsList.length === 0}
      <div class="empty">no sessions yet</div>
    {:else}
      {#each sessionsList as item (item.convId)}
        <button
          class="item session"
          class:selected={selectedPath === `sessions/${item.convId}`}
          onclick={() => { onOpenSession(item.convId); onClose?.() }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            opacity="0.5"
          >
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span class="session-inner">
            <span class="session-title">{item.title}</span>
            <span class="session-date">{new Date(item.lastModified).toLocaleDateString()}</span>
          </span>
        </button>
      {/each}
    {/if}
  </div>
</aside>

<!-- ── Recursive tree snippet ─────────────────────────────────────────────── -->
{#snippet treeNode(node: TreeNode, depth: number)}
  {#if node.kind === 'directory'}
    <button class="item dir" style="padding-left: {12 + depth * 14}px" onclick={() => expandDir(node)}>
      <svg
        class="chevron"
        class:open={node.expanded}
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" opacity="0.5">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
      <span>{node.name}</span>
    </button>
    {#if node.expanded && node.children}
      {#each node.children as child}
        {@render treeNode(child, depth + 1)}
      {/each}
    {/if}
  {:else}
    <button
      class="item file"
      class:selected={selectedPath === node.path}
      style="padding-left: {12 + depth * 14}px"
      onclick={() => { onOpenFile(node.path); onClose?.() }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        opacity="0.5"
      >
        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
        <polyline points="13 2 13 9 20 9" />
      </svg>
      <span>{node.name}</span>
    </button>
  {/if}
{/snippet}

<style>
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: var(--surface-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .header {
    padding: 14px 12px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .btn-refresh {
    margin-left: auto;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    border-radius: 4px;
    transition: color 0.1s, background 0.1s;
  }
  .btn-refresh:hover {
    color: var(--text-primary);
    background: var(--surface-hover);
  }

  .tree {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .section-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 4px 12px;
    margin-bottom: 2px;
  }
  .section-label.gap {
    margin-top: 16px;
  }

  .empty {
    font-size: 0.78rem;
    color: var(--text-muted);
    padding: 2px 12px 6px;
    font-style: italic;
  }

  /* ── Tree items ── */
  .item {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.82rem;
    color: var(--text-secondary);
    padding-top: 4px;
    padding-bottom: 4px;
    padding-right: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.1s, color 0.1s;
  }
  .item:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .item.selected {
    background: var(--surface-active);
    color: var(--accent);
  }
  .item span {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  /* dir items use default padding-left (set via style prop) */
  .item.dir {
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .item.file {
    padding-top: 4px;
    padding-bottom: 4px;
  }

  /* Session items: two-line layout */
  .item.session {
    align-items: flex-start;
    padding-top: 6px;
    padding-bottom: 6px;
    padding-left: 12px;
  }
  .item.session > svg {
    flex-shrink: 0;
    margin-top: 2px;
  }

  .session-inner {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .session-title {
    font-size: 0.82rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
  }
  .session-date {
    font-size: 0.7rem;
    color: var(--text-muted);
    display: block;
  }
  .item.session:hover .session-title,
  .item.session.selected .session-title {
    color: inherit;
  }

  /* ── Mobile: slide-in drawer ── */
  @media (max-width: 639px) {
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      height: 100%;
      z-index: 50;
      width: 280px;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
    }

    .sidebar.mobile-open {
      transform: translateX(0);
    }
  }

  /* Chevron (for directory expand/collapse) */
  .chevron {
    flex-shrink: 0;
    transition: transform 0.15s;
  }
  .chevron.open {
    transform: rotate(90deg);
  }
</style>
