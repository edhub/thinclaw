<!--
  FileEditor — file viewer/editor pane.
-->
<script lang="ts">
  import { FileText, Download, Printer, Save } from 'lucide-svelte'
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

  const isMarkdown = $derived(!!selectedPath?.match(/\.(md|markdown)$/i))
  const isSession = $derived(sessionEntries !== null)
</script>

{#if !selectedPath}
  <div class="flex flex-1 flex-col items-center justify-center gap-3 text-fg-muted text-[0.9rem]">
    <FileText size={40} class="opacity-30" />
    <p>Select a file to view</p>
  </div>
{:else if loading || sessionLoading}
  <div class="flex flex-1 flex-col items-center justify-center">
    <p class="text-fg-muted">Loading…</p>
  </div>
{:else if loadError}
  <div class="flex flex-1 flex-col items-center justify-center">
    <p class="text-error">{loadError}</p>
  </div>
{:else if isSession && sessionEntries}
  <SessionViewer entries={sessionEntries} />
{:else}
  <!-- Toolbar -->
  <div
    class="flex items-center gap-2.5 px-4 py-2 border-b border-line bg-surface-sidebar
              shrink-0 min-h-[44px]"
  >
    <span
      class="flex-1 text-[0.82rem] text-fg-muted font-mono overflow-hidden text-ellipsis
                 whitespace-nowrap"
    >
      {selectedPath}
    </span>
    <div class="flex items-center gap-1.5 shrink-0">
      {#if isMarkdown}
        <div class="flex border border-line rounded-md overflow-hidden">
          <button
            class="mode-btn px-2.5 py-1 text-[0.78rem] bg-transparent border-none cursor-pointer
                   text-fg-sub transition-colors duration-100 hover:bg-surface-hover"
            class:active={mode === 'preview'}
            onclick={() => onSwitchMode('preview')}>Preview</button
          >
          <button
            class="mode-btn px-2.5 py-1 text-[0.78rem] bg-transparent border-none cursor-pointer
                   text-fg-sub transition-colors duration-100 hover:bg-surface-hover"
            class:active={mode === 'edit'}
            onclick={() => onSwitchMode('edit')}>Edit</button
          >
        </div>
      {/if}
      {#if dirty}
        <button
          class="flex items-center gap-1.5 px-3 py-1 text-[0.8rem] bg-accent text-white
                 border-none rounded-md cursor-pointer font-medium transition-opacity duration-100
                 disabled:opacity-60 disabled:cursor-default hover:opacity-85"
          onclick={onSave}
          disabled={saving}
        >
          <Save size={13} />
          {saving ? 'Saving…' : 'Save'}
        </button>
      {/if}
      <button
        class="w-[30px] h-[30px] flex items-center justify-center bg-transparent border border-line
               rounded-md cursor-pointer text-fg-sub transition-colors duration-100
               hover:bg-surface-hover hover:text-fg"
        onclick={onDownload}
        title="Download"
      >
        <Download size={15} />
      </button>
      <button
        class="w-[30px] h-[30px] flex items-center justify-center bg-transparent border border-line
               rounded-md cursor-pointer text-fg-sub transition-colors duration-100
               hover:bg-surface-hover hover:text-fg"
        onclick={() => window.print()}
        title="Print"
      >
        <Printer size={15} />
      </button>
    </div>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-hidden flex flex-col">
    {#if mode === 'edit' || !isMarkdown}
      <textarea
        class="flex-1 w-full px-6 py-5 bg-surface text-fg border-none resize-none
               font-mono text-[0.875rem] leading-[1.7] outline-none box-border"
        class:plain={!isMarkdown}
        value={editContent}
        oninput={(e) => onEditInput((e.target as HTMLTextAreaElement).value)}
        spellcheck={false}
      ></textarea>
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div
        class="markdown-body flex-1 overflow-y-auto px-8 py-6 max-w-[780px] text-fg
                  leading-[1.75] text-[0.9375rem] break-words"
      >
        {@html renderedHtml}
      </div>
    {/if}
  </div>
{/if}

<style>
  .mode-btn.active {
    background: var(--surface-active);
    color: var(--accent);
    font-weight: 500;
  }

  .plain {
    font-family: inherit;
  }

  /* Print: hide toolbar, show only content */
  @media print {
    /* Toolbar handled by parent layout */
    :global(.toolbar) {
      display: none;
    }
  }
</style>
