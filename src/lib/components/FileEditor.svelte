<!--
  FileEditor — file viewer/editor pane.
  Handles: empty state, loading state, session viewer, Markdown preview/edit, plain text editor.
  Layout-specific .markdown-body styles live here; typography is in app.css.
-->
<script lang="ts">
  import SessionViewer from '$lib/components/SessionViewer.svelte'
  import type { SessionEntry } from '$lib/fs/session-recorder'

  interface Props {
    selectedPath: string | null
    loading: boolean
    sessionLoading: boolean
    loadError: string | null
    fileContent: string
    editContent: string
    renderedHtml: string
    mode: 'preview' | 'edit'
    dirty: boolean
    saving: boolean
    sessionEntries: SessionEntry[] | null
    onSave: () => void
    onDownload: () => void
    onSwitchMode: (m: 'preview' | 'edit') => Promise<void>
    onEditInput: (val: string) => void
  }
  let {
    selectedPath,
    loading,
    sessionLoading,
    loadError,
    fileContent,
    editContent,
    renderedHtml,
    mode,
    dirty,
    saving,
    sessionEntries,
    onSave,
    onDownload,
    onSwitchMode,
    onEditInput,
  }: Props = $props()

  // Derived locally — no need to pass as props
  const isMarkdown = $derived(!!selectedPath?.match(/\.(md|markdown)$/i))
  const isSession = $derived(sessionEntries !== null)
</script>

{#if !selectedPath}
  <div class="empty-state">
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      opacity="0.3"
    >
      <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
      <polyline points="13 2 13 9 20 9" />
    </svg>
    <p>Select a file to view</p>
  </div>
{:else if loading || sessionLoading}
  <div class="empty-state"><p style="color: var(--text-muted)">Loading…</p></div>
{:else if loadError}
  <div class="empty-state"><p style="color: var(--error)">{loadError}</p></div>
{:else if isSession && sessionEntries}
  <SessionViewer entries={sessionEntries} />
{:else}
  <!-- Toolbar -->
  <div class="toolbar">
    <span class="file-path">{selectedPath}</span>
    <div class="actions">
      {#if isMarkdown}
        <div class="mode-toggle">
          <button
            class="mode-btn"
            class:active={mode === 'preview'}
            onclick={() => onSwitchMode('preview')}
          >Preview</button>
          <button
            class="mode-btn"
            class:active={mode === 'edit'}
            onclick={() => onSwitchMode('edit')}
          >Edit</button>
        </div>
      {/if}
      {#if dirty}
        <button class="btn-primary" onclick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      {/if}
      <button class="btn-icon" onclick={onDownload} title="Download">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
      <button class="btn-icon" onclick={() => window.print()} title="Print">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Content -->
  <div class="content">
    {#if mode === 'edit' || !isMarkdown}
      <textarea
        class="editor"
        class:plain={!isMarkdown}
        value={editContent}
        oninput={(e) => onEditInput((e.target as HTMLTextAreaElement).value)}
        spellcheck={false}
      ></textarea>
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="markdown-body">{@html renderedHtml}</div>
    {/if}
  </div>
{/if}

<style>
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

  .actions {
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
  .mode-btn:hover {
    background: var(--surface-hover);
  }
  .mode-btn.active {
    background: var(--surface-active);
    color: var(--accent);
    font-weight: 500;
  }

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
  .btn-primary:disabled {
    opacity: 0.6;
    cursor: default;
  }

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
  .btn-icon:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  /* Content area */
  .content {
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

  /* Markdown preview — typography rules are in app.css */
  .markdown-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px 32px;
    max-width: 780px;
    color: var(--text-primary);
    line-height: 1.75;
    font-size: 0.9375rem;
    word-break: break-word;
  }

  /* Print: hide toolbar, show only content */
  @media print {
    .toolbar {
      display: none;
    }

    /* Remove all overflow/height clipping so full content prints */
    .content {
      overflow: visible !important;
      height: auto !important;
      flex: none !important;
    }

    .editor {
      overflow: visible !important;
      height: auto !important;
      padding: 0;
      font-size: 0.75rem;
      width: 100%;
      max-width: 100%;
    }

    .markdown-body {
      overflow: visible !important;
      height: auto !important;
      padding: 0;
      max-width: none;
      font-size: 0.825rem;
    }

    /* Ink-friendly: raw editor textarea uses light background */
    .editor {
      background: #f4f4f4 !important;
      color: #1a1a1a !important;
      border: 1px solid #cccccc !important;
    }
  }
</style>
