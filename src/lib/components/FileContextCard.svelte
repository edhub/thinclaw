<script lang="ts">
  import { FileText, AlertCircle, ChevronRight } from 'lucide-svelte'

  /**
   * Renders a single <file-context> block parsed from a user message.
   * Collapsed by default to keep chat history clean.
   */
  export interface FileContext {
    path: string
    lines?: string
    total?: number
    truncated: boolean
    error: boolean
    content: string
  }

  interface Props {
    file: FileContext
  }
  let { file }: Props = $props()

  let expanded = $state(false)

  const metaLabel = $derived(
    file.truncated && file.lines && file.total ? `第 ${file.lines} 行 / 共 ${file.total} 行` : null,
  )

  const fileName = $derived(file.path.split('/').pop() ?? file.path)
</script>

<div class="fc-card" class:fc-error={file.error}>
  <button
    class="fc-header flex items-center gap-1.5 w-full px-2.5 py-1.5 bg-transparent border-none
           cursor-pointer text-left text-fg-sub transition-colors duration-100
           hover:bg-surface-hover min-w-0"
    onclick={() => (expanded = !expanded)}
    type="button"
    aria-expanded={expanded}
  >
    <span class="flex-shrink-0 text-fg-muted" class:error-icon={file.error}>
      {#if file.error}
        <AlertCircle size={12} />
      {:else}
        <FileText size={12} />
      {/if}
    </span>

    <span
      class="fc-path font-medium text-fg whitespace-nowrap flex-shrink-0 font-mono text-[0.78rem]"
      title={file.path}>{fileName}</span
    >

    {#if file.path !== fileName}
      <span
        class="text-fg-muted whitespace-nowrap overflow-hidden text-ellipsis min-w-0
                   font-mono text-[0.78rem]"
      >
        {file.path.slice(0, -(fileName.length + 1))}/
      </span>
    {/if}

    {#if metaLabel}
      <span class="text-fg-muted whitespace-nowrap flex-shrink-0 ml-0.5 text-[0.78rem]">
        {metaLabel}
      </span>
    {/if}

    {#if file.truncated}
      <span
        class="text-[0.68rem] px-1.5 py-px rounded bg-surface-hover text-fg-muted
                   border border-line flex-shrink-0">截断</span
      >
    {/if}

    <ChevronRight
      size={11}
      class="ml-auto flex-shrink-0 text-fg-muted transition-transform duration-[180ms]
             {expanded ? 'rotate-90' : ''}"
    />
  </button>

  {#if expanded}
    {#if file.error}
      <p class="m-0 px-3 py-2 text-[0.78rem] text-error border-t border-error bg-error-bg">
        文件读取失败，可能已被移动或删除。
      </p>
    {:else}
      <pre
        class="fc-content m-0 px-3 py-2.5 text-[0.78rem] font-mono text-fg-sub
                  border-t border-line whitespace-pre overflow-x-auto max-h-[320px]
                  overflow-y-auto leading-[1.55]"
        style="background: var(--code-bg);">{file.content}</pre>
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

  .error-icon {
    color: var(--error) !important;
  }
</style>
