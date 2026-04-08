<script lang="ts">
  import { onMount } from 'svelte'
  import { RefreshCw, ChevronRight, Folder, FileText, MessageSquare } from 'lucide-svelte'
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

  interface TreeNode {
    name: string
    path: string
    kind: 'file' | 'directory'
    children?: TreeNode[] | null
    expanded: boolean
  }

  let workspaceTree = $state<TreeNode[]>([])
  let tmpTree = $state<TreeNode[]>([])
  let sessionsList = $state<SessionListItem[]>([])

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
      node.children = toNodes(await listDir(node.path), node.path)
    }
    node.expanded = !node.expanded
  }

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

<aside
  class="ft-sidebar flex flex-col bg-surface-sidebar border-r border-line overflow-hidden
         w-[220px] shrink-0"
  class:mobile-open={open}
>
  <!-- Header -->
  <div class="flex items-center px-3 pt-3.5 pb-2.5 border-b border-line shrink-0">
    <span class="flex-1 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-fg-muted">
      Files
    </span>
    <button
      class="w-[22px] h-[22px] flex items-center justify-center bg-transparent border-none
             cursor-pointer text-fg-muted rounded hover:text-fg hover:bg-surface-hover
             transition-colors duration-100"
      onclick={refresh}
      title="Refresh"
    >
      <RefreshCw size={12} />
    </button>
  </div>

  <div class="flex-1 overflow-y-auto py-2">
    <!-- workspace -->
    <div
      class="px-3 py-1 mb-0.5 text-[0.7rem] font-semibold uppercase
                tracking-[0.06em] text-fg-muted"
    >
      workspace
    </div>
    {#if workspaceTree.length === 0}
      <div class="px-3 pb-1.5 text-[0.78rem] text-fg-muted italic">empty</div>
    {:else}
      {#each workspaceTree as node}{@render treeNode(node, 0)}{/each}
    {/if}

    <!-- tmp -->
    <div
      class="px-3 py-1 mb-0.5 mt-4 text-[0.7rem] font-semibold uppercase
                tracking-[0.06em] text-fg-muted"
    >
      tmp
    </div>
    {#if tmpTree.length === 0}
      <div class="px-3 pb-1.5 text-[0.78rem] text-fg-muted italic">empty</div>
    {:else}
      {#each tmpTree as node}{@render treeNode(node, 0)}{/each}
    {/if}

    <!-- sessions -->
    <div
      class="px-3 py-1 mb-0.5 mt-4 text-[0.7rem] font-semibold uppercase
                tracking-[0.06em] text-fg-muted"
    >
      sessions
    </div>
    {#if sessionsList.length === 0}
      <div class="px-3 pb-1.5 text-[0.78rem] text-fg-muted italic">no sessions yet</div>
    {:else}
      {#each sessionsList as item (item.convId)}
        <button
          class="tree-item flex items-start gap-1.5 w-full text-left bg-transparent border-none
                 cursor-pointer text-[0.82rem] text-fg-sub px-3 py-1.5 overflow-hidden
                 transition-colors duration-100 hover:bg-surface-hover hover:text-fg"
          class:selected={selectedPath === `sessions/${item.convId}`}
          onclick={() => {
            onOpenSession(item.convId)
            onClose?.()
          }}
        >
          <MessageSquare size={12} class="shrink-0 mt-0.5 opacity-50" />
          <span class="flex flex-col gap-0.5 min-w-0 flex-1">
            <span class="text-[0.82rem] overflow-hidden text-ellipsis whitespace-nowrap block">
              {item.title}
            </span>
            <span class="text-[0.7rem] text-fg-muted block">
              {new Date(item.lastModified).toLocaleDateString()}
            </span>
          </span>
        </button>
      {/each}
    {/if}
  </div>
</aside>

{#snippet treeNode(node: TreeNode, depth: number)}
  {#if node.kind === 'directory'}
    <button
      class="tree-item flex items-center gap-1.5 w-full text-left bg-transparent border-none
             cursor-pointer text-[0.82rem] text-fg-sub py-1 pr-2.5 overflow-hidden
             whitespace-nowrap transition-colors duration-100
             hover:bg-surface-hover hover:text-fg"
      style="padding-left: {12 + depth * 14}px"
      onclick={() => expandDir(node)}
    >
      <ChevronRight
        size={10}
        class="shrink-0 transition-transform duration-150
               {node.expanded ? 'rotate-90' : ''}"
      />
      <Folder size={13} class="shrink-0 opacity-50" />
      <span class="overflow-hidden text-ellipsis flex-1">{node.name}</span>
    </button>
    {#if node.expanded && node.children}
      {#each node.children as child}{@render treeNode(child, depth + 1)}{/each}
    {/if}
  {:else}
    <button
      class="tree-item flex items-center gap-1.5 w-full text-left bg-transparent border-none
             cursor-pointer text-[0.82rem] text-fg-sub py-1 pr-2.5 overflow-hidden
             whitespace-nowrap transition-colors duration-100
             hover:bg-surface-hover hover:text-fg"
      class:selected={selectedPath === node.path}
      style="padding-left: {12 + depth * 14}px"
      onclick={() => {
        onOpenFile(node.path)
        onClose?.()
      }}
    >
      <FileText size={12} class="shrink-0 opacity-50" />
      <span class="overflow-hidden text-ellipsis flex-1">{node.name}</span>
    </button>
  {/if}
{/snippet}

<style>
  .tree-item.selected {
    background: var(--surface-active);
    color: var(--accent);
  }

  /* Mobile slide-in drawer */
  @media (max-width: 639px) {
    .ft-sidebar {
      position: fixed;
      left: 0;
      top: 0;
      height: 100%;
      z-index: 50;
      width: 280px;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
      /* Push content below iOS status bar; background still fills the safe area */
      padding-top: env(safe-area-inset-top, 0px);
    }
    .ft-sidebar.mobile-open {
      transform: translateX(0);
    }
  }

  @media print {
    .ft-sidebar {
      display: none;
    }
  }
</style>
