<script lang="ts">
  import type { ToolCall, ToolResultMessage, TextContent } from '@mariozechner/pi-ai'
  import type { GeneratedImage } from '$lib/agent/image'

  interface Props {
    call: ToolCall
    result?: ToolResultMessage | null
    /** Auto-expand the card when the result arrives. Default: false. */
    defaultExpanded?: boolean
  }
  let { call, result = null, defaultExpanded = false }: Props = $props()

  let expanded = $state(false)

  // Auto-expand when result arrives (transitions null → value) and defaultExpanded is set.
  // Plain let (not $state) — only used as a side-effect tracker inside the effect.
  let prevResult: ToolResultMessage | null = null
  $effect(() => {
    if (result && !prevResult && defaultExpanded) {
      expanded = true
    }
    prevResult = result
  })

  const isPending = $derived(!result)
  const isError = $derived(result?.isError ?? false)

  // ── Human-readable title ─────────────────────────────────────────────────

  function toolTitle(name: string, args: Record<string, unknown>): string {
    const rawPath = String(args.path ?? args.file_path ?? '')
    // Strip leading workspace/ or tmp/ for brevity
    const short = rawPath ? rawPath.replace(/^(?:workspace|tmp)\//, '') : ''

    switch (name) {
      case 'fs_read':
        return `读取 ${short || '文件'}`
      case 'fs_write':
        return `写入 ${short || '文件'}`
      case 'fs_edit':
        return `编辑 ${short || '文件'}`
      case 'fs_list':
        return `列出 ${short || '目录'}`
      case 'fs_search':
        return `搜索${args.query ? ' "' + String(args.query).slice(0, 40) + '"' : ''}`
      case 'fs_delete':
        return `删除 ${short || '文件'}`
      case 'fs_move':
        return `移动 ${short || '文件'}`
      case 'fs_stat':
        return `查看 ${short || '文件'}`
      case 'calculate':
        return `计算 ${String(args.expression ?? '').slice(0, 50)}`
      case 'datetime':
        return '获取当前时间'
      case 'memory_add':
        return '存储记忆'
      case 'memory_list':
        return '查看记忆'
      case 'memory_delete':
        return '删除记忆'
      case 'soul_read':
        return '读取自我认知'
      case 'soul_update':
        return '更新自我认知'
      case 'generate_image':
        return `生成图片${args.prompt ? ': ' + String(args.prompt).slice(0, 40) : ''}`
      default:
        return name
    }
  }

  const title = $derived(toolTitle(call.name, call.arguments))

  // ── Result helpers ───────────────────────────────────────────────────────

  const resultText = $derived(
    result?.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as TextContent).text)
      .join('\n') ?? '',
  )

  const generatedImage = $derived(
    result?.toolName === 'generate_image' && !result.isError
      ? (result.details as GeneratedImage | null)
      : null,
  )

  const openFilePath = $derived(
    (() => {
      if (!result || result.isError) return null
      switch (result.toolName) {
        case 'fs_write': {
          const m = resultText.match(/^Written: (.+?) \(/)
          return m?.[1] ?? null
        }
        case 'fs_edit': {
          const m = resultText.match(/^Edited: (.+)$/m)
          return m?.[1]?.trim() ?? null
        }
        case 'fs_move': {
          const m = resultText.match(/→ (.+)$/m)
          return m?.[1]?.trim() ?? null
        }
        default:
          return null
      }
    })(),
  )

  const hasArgs = $derived(Object.keys(call.arguments).length > 0)
</script>

<div class="tool-card" class:error={isError}>
  <button class="tool-header" onclick={() => (expanded = !expanded)} type="button">
    <!-- Status icon -->
    <span class="status-icon" class:status-pending={isPending} class:status-error={isError} class:status-ok={!isPending && !isError}>
      {#if isPending}
        <span class="spinner"></span>
      {:else if isError}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      {/if}
    </span>

    <span class="tool-title">{title}</span>

    <!-- Chevron -->
    <svg
      class="chevron"
      class:open={expanded}
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if openFilePath}
    <div class="file-link-row">
      <a
        href="/files?path={encodeURIComponent(openFilePath)}"
        target="_blank"
        rel="noopener noreferrer"
        class="open-link"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </svg>
        {openFilePath}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </a>
    </div>
  {/if}

  {#if expanded}
    <div class="tool-body">
      <!-- Args -->
      {#if hasArgs}
        <div class="section">
          <span class="section-label">参数</span>
          <pre class="code-block">{JSON.stringify(call.arguments, null, 2)}</pre>
        </div>
      {/if}

      <!-- Result -->
      {#if result}
        <div class="section" class:section-divider={hasArgs}>
          <span class="section-label" class:label-error={isError}>
            {isError ? '错误' : '结果'}
          </span>
          {#if generatedImage}
            <div class="image-result">
              <img
                src="data:{generatedImage.mimeType};base64,{generatedImage.imageData}"
                alt={generatedImage.prompt}
                class="generated-image"
              />
              <div class="image-footer">
                <span class="image-meta">{generatedImage.aspectRatio} · {generatedImage.imageSize}</span>
                <a
                  href="data:{generatedImage.mimeType};base64,{generatedImage.imageData}"
                  download="generated-{result.timestamp ?? Date.now()}.{generatedImage.mimeType.split('/')[1] ?? 'png'}"
                  class="download-link"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  保存图片
                </a>
              </div>
            </div>
          {:else}
            <pre class="code-block">{resultText}</pre>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool-card {
    border: 1px solid var(--border);
    border-radius: 7px;
    margin-bottom: 6px;
    overflow: hidden;
    background: var(--surface-elevated);
  }

  .tool-card.error {
    border-color: var(--error);
  }

  /* Header row — the always-visible part */
  .tool-header {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-secondary);
    font-size: 0.8rem;
    transition: background 0.12s;
    border-radius: 7px;
  }

  .tool-header:hover {
    background: var(--surface-hover);
  }

  /* Status icon */
  .status-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-pending {
    color: var(--text-muted);
  }

  .status-ok {
    color: var(--accent);
  }

  .status-error {
    color: var(--error);
  }

  /* Spinner for pending */
  .spinner {
    display: block;
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--border);
    border-top-color: var(--text-muted);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Title text */
  .tool-title {
    flex: 1;
    font-family: monospace;
    font-size: 0.78rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Expand chevron */
  .chevron {
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform 0.18s;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  /* Expanded body */
  .tool-body {
    border-top: 1px solid var(--border);
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .section-divider {
    border-top: 1px solid var(--border);
    padding-top: 8px;
    margin-top: 8px;
  }

  .section-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }

  .label-error {
    color: var(--error);
  }

  /* Code block (args + result text) */
  .code-block {
    margin: 0;
    font-size: 0.73rem;
    font-family: monospace;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    background: var(--code-bg);
    border-radius: 5px;
    padding: 6px 8px;
    line-height: 1.5;
  }

  /* Generated image */
  .image-result {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .generated-image {
    display: block;
    max-width: 100%;
    border-radius: 5px;
    border: 1px solid var(--border);
  }

  .image-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .image-meta {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-family: monospace;
  }

  .download-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.75rem;
    color: var(--accent);
    text-decoration: none;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.1s;
  }

  .download-link:hover {
    background: var(--surface-active);
  }

  /* Open file link — always visible, sits between header and body */
  .file-link-row {
    padding: 0 10px 6px;
  }

  .open-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.75rem;
    font-family: monospace;
    color: var(--accent);
    text-decoration: none;
    padding: 2px 4px;
    border-radius: 4px;
    transition: background 0.1s;
  }

  .open-link:hover {
    background: var(--surface-active);
  }
</style>
