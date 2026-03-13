<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { readFile, writeFile, listDir } from '$lib/fs/opfs';
  import type { ListEntry } from '$lib/fs/opfs';
  import { renderMarkdown } from '$lib/utils/markdown';

  // ─── Types ────────────────────────────────────────────────────────────────

  interface TreeNode {
    name: string;
    path: string;         // as used by OPFS: 'notes/daily.md' or 'tmp/foo.md'
    kind: 'file' | 'directory';
    children?: TreeNode[] | null; // undefined = file (n/a), null = dir not yet loaded, array = loaded
    expanded: boolean;
  }

  // ─── State ────────────────────────────────────────────────────────────────

  let workspaceTree = $state<TreeNode[]>([]);
  let tmpTree       = $state<TreeNode[]>([]);

  let selectedPath  = $state<string | null>(null);
  let fileContent   = $state('');
  let editContent   = $state('');
  let renderedHtml  = $state('');

  let mode    = $state<'preview' | 'edit'>('preview');
  let dirty   = $state(false);
  let saving  = $state(false);
  let loading = $state(false);
  let loadError = $state<string | null>(null);

  const fileName   = $derived(selectedPath?.split('/').pop() ?? '');
  const isMarkdown = $derived(!!selectedPath?.match(/\.(md|markdown)$/i));

  // ─── Tree helpers ─────────────────────────────────────────────────────────

  function toNodes(entries: ListEntry[], parentPath: string): TreeNode[] {
    const nodes: TreeNode[] = entries.map((e) => ({
      name: e.name,
      path: parentPath ? `${parentPath}/${e.name}` : e.name,
      kind: e.kind,
      children: e.kind === 'directory' ? null : undefined,
      expanded: false,
    }));
    // directories first, then files, both alphabetical
    return nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async function expandDir(node: TreeNode): Promise<void> {
    if (node.kind !== 'directory') return;
    if (node.children === null || node.children === undefined) {
      const entries = await listDir(node.path);
      node.children = toNodes(entries, node.path);
    }
    node.expanded = !node.expanded;
  }

  /** Expand all ancestor directories of `path` so the file is visible in the tree. */
  async function expandToPath(path: string): Promise<void> {
    const isTmp  = path.startsWith('tmp/') || path === 'tmp';
    const parts  = isTmp ? path.split('/').slice(1) : path.split('/');
    let   nodes  = isTmp ? tmpTree : workspaceTree;

    for (let i = 0; i < parts.length - 1; i++) {
      const node = nodes.find((n) => n.name === parts[i] && n.kind === 'directory');
      if (!node) break;
      if (node.children === null || node.children === undefined) {
        const entries = await listDir(node.path);
        node.children = toNodes(entries, node.path);
      }
      node.expanded = true;
      nodes = node.children ?? [];
    }
  }

  // ─── File operations ──────────────────────────────────────────────────────

  async function openFile(path: string): Promise<void> {
    selectedPath = path;
    loading      = true;
    loadError    = null;
    mode         = 'preview';
    dirty        = false;
    try {
      const result = await readFile(path);
      fileContent  = result.content;
      editContent  = result.content;
      renderedHtml = isMarkdown ? await renderMarkdown(fileContent) : '';
      // Update URL without reloading
      history.replaceState(null, '', `/files?path=${encodeURIComponent(path)}`);
    } catch (e) {
      loadError   = e instanceof Error ? e.message : String(e);
      fileContent = '';
    } finally {
      loading = false;
    }
  }

  async function saveFile(): Promise<void> {
    if (!selectedPath || !dirty) return;
    saving = true;
    try {
      await writeFile(selectedPath, editContent);
      fileContent  = editContent;
      dirty        = false;
      renderedHtml = isMarkdown ? await renderMarkdown(fileContent) : '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }

  function downloadFile(): void {
    if (!selectedPath) return;
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: fileName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }

  function handleEditInput(e: Event): void {
    editContent = (e.target as HTMLTextAreaElement).value;
    dirty = editContent !== fileContent;
  }

  function handleKeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
  }

  async function refreshTree(): Promise<void> {
    const [wsEntries, tmpEntries] = await Promise.allSettled([
      listDir(''),
      listDir('tmp'),
    ]);
    if (wsEntries.status  === 'fulfilled') workspaceTree = toNodes(wsEntries.value,  '');
    if (tmpEntries.status === 'fulfilled') tmpTree       = toNodes(tmpEntries.value, 'tmp');
  }

  async function switchMode(next: 'preview' | 'edit'): Promise<void> {
    if (mode === 'edit' && next === 'preview' && isMarkdown) {
      renderedHtml = await renderMarkdown(editContent);
    }
    mode = next;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  onMount(async () => {
    document.title = 'Files — ThinClaw';
    document.addEventListener('keydown', handleKeydown);

    // Load tree roots in parallel
    const [wsEntries, tmpEntries] = await Promise.allSettled([
      listDir(''),
      listDir('tmp'),
    ]);
    if (wsEntries.status  === 'fulfilled') workspaceTree = toNodes(wsEntries.value,  '');
    if (tmpEntries.status === 'fulfilled') tmpTree       = toNodes(tmpEntries.value, 'tmp');

    // Open file from ?path= URL param
    const pathParam = new URLSearchParams(location.search).get('path');
    if (pathParam) {
      await expandToPath(pathParam);
      await openFile(pathParam);
    }
  });

  onDestroy(() => document.removeEventListener('keydown', handleKeydown));
</script>

<div class="layout">

  <!-- ── Sidebar ─────────────────────────────────────────────────────── -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Files</span>
      <button class="refresh-btn" onclick={refreshTree} title="Refresh tree">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
        </svg>
      </button>
    </div>

    <div class="tree">
      <!-- Workspace section -->
      <div class="tree-section-label">workspace</div>
      {#if workspaceTree.length === 0}
        <div class="tree-empty">empty</div>
      {:else}
        {#each workspaceTree as node}
          {@render treeNode(node, 0)}
        {/each}
      {/if}

      <!-- Tmp section -->
      <div class="tree-section-label" style="margin-top: 16px;">tmp</div>
      {#if tmpTree.length === 0}
        <div class="tree-empty">empty</div>
      {:else}
        {#each tmpTree as node}
          {@render treeNode(node, 0)}
        {/each}
      {/if}
    </div>
  </aside>

  <!-- ── Main ────────────────────────────────────────────────────────── -->
  <main class="main">
    {#if !selectedPath}
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3">
          <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
          <polyline points="13 2 13 9 20 9"/>
        </svg>
        <p>Select a file to view</p>
      </div>

    {:else if loading}
      <div class="empty-state">
        <p style="color: var(--text-muted)">Loading…</p>
      </div>

    {:else if loadError}
      <div class="empty-state">
        <p style="color: var(--error)">{loadError}</p>
      </div>

    {:else}
      <!-- Toolbar -->
      <div class="toolbar">
        <span class="file-path">{selectedPath}</span>
        <div class="toolbar-actions">
          {#if isMarkdown}
            <div class="mode-toggle">
              <button
                class="mode-btn"
                class:active={mode === 'preview'}
                onclick={() => switchMode('preview')}
              >Preview</button>
              <button
                class="mode-btn"
                class:active={mode === 'edit'}
                onclick={() => switchMode('edit')}
              >Edit</button>
            </div>
          {/if}
          {#if dirty}
            <button class="btn-primary" onclick={saveFile} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          {/if}
          <button class="btn-icon" onclick={downloadFile} title="Download">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Content -->
      <div class="file-content">
        {#if mode === 'edit' || !isMarkdown}
          <textarea
            class="editor"
            class:plain={!isMarkdown}
            value={editContent}
            oninput={handleEditInput}
            spellcheck={false}
          ></textarea>
        {:else}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="markdown-body">{@html renderedHtml}</div>
        {/if}
      </div>
    {/if}
  </main>
</div>

<!-- ── Recursive tree node snippet ────────────────────────────────────────── -->
{#snippet treeNode(node: TreeNode, depth: number)}
  {#if node.kind === 'directory'}
    <button
      class="tree-item tree-dir"
      style="padding-left: {12 + depth * 14}px"
      onclick={() => expandDir(node)}
    >
      <svg
        class="chevron" class:open={node.expanded}
        width="10" height="10" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2.5"
      >
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" opacity="0.5">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
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
      class="tree-item tree-file"
      class:selected={selectedPath === node.path}
      style="padding-left: {12 + depth * 14}px"
      onclick={() => openFile(node.path)}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5">
        <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
        <polyline points="13 2 13 9 20 9"/>
      </svg>
      <span>{node.name}</span>
    </button>
  {/if}
{/snippet}

<style>
  .layout {
    display: flex;
    height: 100vh;
    background: var(--surface-main);
    color: var(--text-primary);
    font-family: inherit;
  }

  /* ── Sidebar ── */
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: var(--surface-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    padding: 14px 12px 10px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .refresh-btn {
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
  .refresh-btn:hover { color: var(--text-primary); background: var(--surface-hover); }

  .sidebar-title {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .tree {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .tree-section-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding: 4px 12px;
    margin-bottom: 2px;
  }

  .tree-empty {
    font-size: 0.78rem;
    color: var(--text-muted);
    padding: 2px 12px 6px;
    font-style: italic;
  }

  .tree-item {
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
    border-radius: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.1s, color 0.1s;
  }

  .tree-item:hover { background: var(--surface-hover); color: var(--text-primary); }
  .tree-item.selected { background: var(--surface-active); color: var(--accent); }

  .tree-item span {
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 0.15s;
  }
  .chevron.open { transform: rotate(90deg); }

  /* ── Main ── */
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-sidebar);
    flex-shrink: 0;
    min-height: 44px;
  }

  .file-path {
    flex: 1;
    font-size: 0.82rem;
    color: var(--text-muted);
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .mode-toggle {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .mode-btn {
    padding: 4px 10px;
    font-size: 0.78rem;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background 0.1s, color 0.1s;
  }
  .mode-btn:hover    { background: var(--surface-hover); }
  .mode-btn.active   { background: var(--surface-active); color: var(--accent); font-weight: 500; }

  .btn-primary {
    padding: 4px 12px;
    font-size: 0.8rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    transition: opacity 0.1s;
  }
  .btn-primary:disabled { opacity: 0.6; cursor: default; }

  .btn-icon {
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background 0.1s, color 0.1s;
  }
  .btn-icon:hover { background: var(--surface-hover); color: var(--text-primary); }

  /* File content */
  .file-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .editor {
    flex: 1;
    width: 100%;
    padding: 20px 24px;
    background: var(--surface-main);
    color: var(--text-primary);
    border: none;
    resize: none;
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.875rem;
    line-height: 1.7;
    outline: none;
    box-sizing: border-box;
  }

  .editor.plain {
    font-family: inherit;
  }

  .markdown-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
    max-width: 780px;
    color: var(--text-primary);
    line-height: 1.75;
    font-size: 0.9375rem;
  }

  /* Markdown styles (mirrors ChatMessage.svelte) */
  :global(.markdown-body p)             { margin: 0 0 0.75em; }
  :global(.markdown-body p:last-child)  { margin-bottom: 0; }
  :global(.markdown-body h1, .markdown-body h2, .markdown-body h3) {
    font-weight: 600; margin: 1.25em 0 0.5em; line-height: 1.3;
  }
  :global(.markdown-body h1) { font-size: 1.5em; }
  :global(.markdown-body h2) { font-size: 1.25em; }
  :global(.markdown-body h3) { font-size: 1.05em; }
  :global(.markdown-body ul, .markdown-body ol) { padding-left: 1.5em; margin: 0.5em 0; }
  :global(.markdown-body li)  { margin: 0.25em 0; }
  :global(.markdown-body pre) {
    background: var(--code-bg); border-radius: 8px; padding: 12px 16px;
    overflow-x: auto; margin: 0.75em 0; font-size: 0.875em; border: 1px solid var(--border);
  }
  :global(.markdown-body code) {
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace; font-size: 0.875em;
  }
  :global(.markdown-body p code, .markdown-body li code) {
    background: var(--code-inline-bg); padding: 2px 5px; border-radius: 4px;
    color: var(--code-inline-color);
  }
  :global(.markdown-body blockquote) {
    border-left: 3px solid var(--accent); padding-left: 1em;
    margin: 0.75em 0; color: var(--text-secondary);
  }
  :global(.markdown-body table) { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
  :global(.markdown-body th, .markdown-body td) {
    border: 1px solid var(--border); padding: 6px 12px; text-align: left;
  }
  :global(.markdown-body th) { background: var(--surface-elevated); font-weight: 600; }
  :global(.markdown-body a)  { color: var(--accent); text-decoration: underline; }
  :global(.markdown-body hr) { border: none; border-top: 1px solid var(--border); margin: 1em 0; }
</style>
