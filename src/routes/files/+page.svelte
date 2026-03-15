<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { readFile, writeFile } from '$lib/fs/opfs'
  import { renderMarkdown } from '$lib/utils/markdown'
  import {
    readSessionFile,
    parseSessionJsonl,
    type SessionEntry,
  } from '$lib/fs/session-recorder'
  import FileTree from '$lib/components/FileTree.svelte'
  import FileEditor from '$lib/components/FileEditor.svelte'

  // ─── State ────────────────────────────────────────────────────────────────

  let fileTreeRef = $state<{
    expandToPath: (path: string) => Promise<void>
    refresh: () => Promise<void>
  } | undefined>(undefined)

  let selectedPath = $state<string | null>(null)
  let sessionEntries = $state<SessionEntry[] | null>(null)
  let sessionLoading = $state(false)

  let fileContent = $state('')
  let editContent = $state('')
  let renderedHtml = $state('')
  let mode = $state<'preview' | 'edit'>('preview')
  let dirty = $state(false)
  let saving = $state(false)
  let loading = $state(false)
  let loadError = $state<string | null>(null)

  // Mobile tree drawer state
  let treeOpen = $state(false)

  const isMarkdown = $derived(!!selectedPath?.match(/\.(md|markdown)$/i))
  const fileName = $derived(selectedPath?.split('/').pop() ?? '')

  // ─── File operations ──────────────────────────────────────────────────────

  async function openFile(path: string): Promise<void> {
    selectedPath = path
    sessionEntries = null
    loading = true
    loadError = null
    mode = 'preview'
    dirty = false
    try {
      const result = await readFile(path)
      fileContent = result.content
      editContent = result.content
      renderedHtml = isMarkdown ? await renderMarkdown(fileContent) : ''
      history.replaceState(null, '', `/files?path=${encodeURIComponent(path)}`)
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
      fileContent = ''
    } finally {
      loading = false
    }
  }

  async function openSession(convId: string): Promise<void> {
    selectedPath = `sessions/${convId}`
    sessionEntries = null
    sessionLoading = true
    loadError = null
    history.replaceState(null, '', `/files?session=${encodeURIComponent(convId)}`)
    try {
      const raw = await readSessionFile(convId)
      sessionEntries = parseSessionJsonl(raw)
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
      sessionEntries = null
    } finally {
      sessionLoading = false
    }
  }

  async function saveFile(): Promise<void> {
    if (!selectedPath || !dirty) return
    saving = true
    try {
      await writeFile(selectedPath, editContent)
      fileContent = editContent
      dirty = false
      renderedHtml = isMarkdown ? await renderMarkdown(fileContent) : ''
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }

  function downloadFile(): void {
    if (!selectedPath) return
    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName })
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  async function switchMode(next: 'preview' | 'edit'): Promise<void> {
    if (mode === 'edit' && next === 'preview' && isMarkdown) {
      renderedHtml = await renderMarkdown(editContent)
    }
    mode = next
  }

  function handleEditInput(val: string): void {
    editContent = val
    dirty = editContent !== fileContent
  }

  function handleKeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      saveFile()
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────

  onMount(async () => {
    document.title = 'Files — ThinClaw'
    document.addEventListener('keydown', handleKeydown)

    const params = new URLSearchParams(location.search)
    const pathParam = params.get('path')
    const sessParam = params.get('session')

    if (pathParam) {
      await fileTreeRef?.expandToPath(pathParam)
      await openFile(pathParam)
    } else if (sessParam) {
      // FileTree loads sessions on its own mount; we just open by convId.
      await openSession(sessParam)
    }
  })

  onDestroy(() => document.removeEventListener('keydown', handleKeydown))
</script>

<div class="layout">
  <!-- Mobile backdrop -->
  {#if treeOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="mobile-backdrop" role="presentation" onclick={() => (treeOpen = false)}></div>
  {/if}

  <FileTree
    bind:this={fileTreeRef}
    {selectedPath}
    onOpenFile={openFile}
    onOpenSession={openSession}
    open={treeOpen}
    onClose={() => (treeOpen = false)}
  />

  <main class="main">
    <!-- Mobile top bar -->
    <header class="mobile-header">
      <button class="btn-hamburger" onclick={() => (treeOpen = true)} aria-label="打开文件树">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <span class="mobile-title">
        {selectedPath ? selectedPath.split('/').pop() : 'Files'}
      </span>
      <button class="btn-mobile-nav" onclick={() => history.back()} aria-label="返回" title="返回">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>

    <FileEditor
      {selectedPath}
      {loading}
      {sessionLoading}
      {loadError}
      {fileContent}
      {editContent}
      {renderedHtml}
      {mode}
      {dirty}
      {saving}
      {sessionEntries}
      onSave={saveFile}
      onDownload={downloadFile}
      onSwitchMode={switchMode}
      onEditInput={handleEditInput}
    />
  </main>
</div>

<style>
  .layout {
    display: flex;
    height: 100vh;
    background: var(--surface-main);
    color: var(--text-primary);
    font-family: inherit;
  }

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Mobile backdrop ── */
  .mobile-backdrop {
    display: none;
  }

  /* ── Mobile top bar (hidden on desktop) ── */
  .mobile-header {
    display: none;
  }

  @media (max-width: 639px) {
    .mobile-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 40;
    }

    .mobile-header {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 52px;
      padding: 0 8px 0 12px;
      border-bottom: 1px solid var(--border);
      background: var(--surface-main);
      flex-shrink: 0;
    }

    .mobile-title {
      flex: 1;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: center;
    }

    .btn-hamburger,
    .btn-mobile-nav {
      background: none;
      border: none;
      padding: 6px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      text-decoration: none;
      flex-shrink: 0;
      transition: all 0.1s;
    }
    .btn-hamburger:hover,
    .btn-mobile-nav:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }
  }

  @media print {
    .mobile-header,
    .mobile-backdrop {
      display: none !important;
    }
  }
</style>
