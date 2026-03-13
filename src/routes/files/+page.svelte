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
  <FileTree
    bind:this={fileTreeRef}
    {selectedPath}
    onOpenFile={openFile}
    onOpenSession={openSession}
  />
  <main class="main">
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
</style>
