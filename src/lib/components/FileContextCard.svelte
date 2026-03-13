<script lang="ts">
  /**
   * Renders a single <file-context> block parsed from a user message.
   * Collapsed by default to keep chat history clean.
   */
  export interface FileContext {
    path: string;
    /** "1-20" when truncated, undefined when full file was shown. */
    lines?: string;
    /** Total line count of the file, present when truncated. */
    total?: number;
    truncated: boolean;
    error: boolean;
    content: string;
  }

  interface Props {
    file: FileContext;
  }
  let { file }: Props = $props();

  let expanded = $state(false);

  const metaLabel = $derived(
    file.truncated && file.lines && file.total
      ? `第 ${file.lines} 行 / 共 ${file.total} 行`
      : null,
  );

  const fileName = $derived(file.path.split('/').pop() ?? file.path);
</script>

<div class="fc-card" class:fc-error={file.error}>
  <button
    class="fc-header"
    onclick={() => (expanded = !expanded)}
    type="button"
    aria-expanded={expanded}
  >
    <!-- File icon -->
    <svg class="fc-icon" width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      {#if file.error}
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      {:else}
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      {/if}
    </svg>

    <span class="fc-path" title={file.path}>{fileName}</span>

    {#if file.path !== fileName}
      <span class="fc-dir">{file.path.slice(0, -(fileName.length + 1))}/</span>
    {/if}

    {#if metaLabel}
      <span class="fc-meta">{metaLabel}</span>
    {/if}

    {#if file.truncated}
      <span class="fc-truncated-badge">截断</span>
    {/if}

    <svg
      class="fc-chevron"
      class:open={expanded}
      width="11" height="11" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2.5"
    >
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  </button>

  {#if expanded}
    {#if file.error}
      <p class="fc-error-msg">文件读取失败，可能已被移动或删除。</p>
    {:else}
      <pre class="fc-content">{file.content}</pre>
    {/if}
  {/if}
</div>

<style>
  .fc-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 6px;
    background: var(--surface-elevated);
    font-size: 0.8rem;
  }

  .fc-card.fc-error {
    border-color: var(--error);
    opacity: 0.7;
  }

  .fc-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-secondary);
    transition: background 0.1s;
    min-width: 0;
  }

  .fc-header:hover {
    background: var(--surface-hover);
  }

  .fc-icon {
    flex-shrink: 0;
    color: var(--text-muted);
  }

  .fc-error .fc-icon {
    color: var(--error);
  }

  .fc-path {
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    flex-shrink: 0;
    font-family: monospace;
    font-size: 0.78rem;
  }

  .fc-dir {
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    font-family: monospace;
    font-size: 0.78rem;
  }

  .fc-meta {
    color: var(--text-muted);
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 2px;
  }

  .fc-truncated-badge {
    font-size: 0.68rem;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--surface-hover);
    color: var(--text-muted);
    border: 1px solid var(--border);
    flex-shrink: 0;
  }

  .fc-chevron {
    margin-left: auto;
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform 0.18s;
  }

  .fc-chevron.open {
    transform: rotate(90deg);
  }

  .fc-content {
    margin: 0;
    padding: 10px 12px;
    font-size: 0.78rem;
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    color: var(--text-secondary);
    background: var(--code-bg);
    border-top: 1px solid var(--border);
    white-space: pre;
    overflow-x: auto;
    max-height: 320px;
    overflow-y: auto;
    line-height: 1.55;
  }

  .fc-error-msg {
    margin: 0;
    padding: 8px 12px;
    font-size: 0.78rem;
    color: var(--error);
    background: var(--error-bg);
    border-top: 1px solid var(--error);
  }
</style>
