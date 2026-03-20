<script lang="ts">
  import type { ToolCall, ToolResultMessage, TextContent } from '@mariozechner/pi-ai'
  import type { GeneratedImage } from '$lib/agent/image'
  import {
    Loader2,
    AlertCircle,
    Check,
    ChevronDown,
    FileText,
    ExternalLink,
    Download,
  } from 'lucide-svelte'

  interface Props {
    call: ToolCall
    result?: ToolResultMessage | null
    defaultExpanded?: boolean
  }
  let { call, result = null, defaultExpanded = false }: Props = $props()

  let expanded = $state(false)

  let prevResult: ToolResultMessage | null = null
  $effect(() => {
    if (result && !prevResult && defaultExpanded) {
      expanded = true
    }
    prevResult = result
  })

  const isPending = $derived(!result)
  const isError = $derived(result?.isError ?? false)

  function toolTitle(name: string, args: Record<string, unknown>): string {
    const rawPath = String(args.path ?? args.file_path ?? '')
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

<div
  class="tool-card rounded-[7px] mb-1.5 overflow-hidden bg-surface-elevated border"
  class:error={isError}
  style="border-color: {isError ? 'var(--error)' : 'var(--border)'}"
>
  <button
    class="flex items-center gap-1.5 w-full px-2.5 py-1.5 bg-transparent border-none
           cursor-pointer text-left text-fg-sub text-[0.8rem] transition-colors duration-[120ms]
           rounded-[7px] hover:bg-surface-hover"
    onclick={() => (expanded = !expanded)}
    type="button"
  >
    <!-- Status icon -->
    <span
      class="flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0"
      class:status-pending={isPending}
      class:status-error={isError}
      class:status-ok={!isPending && !isError}
    >
      {#if isPending}
        <Loader2 size={10} class="animate-spin text-fg-muted" />
      {:else if isError}
        <AlertCircle size={10} class="text-error" />
      {:else}
        <Check size={10} class="text-accent" />
      {/if}
    </span>

    <span
      class="flex-1 font-mono text-[0.78rem] text-fg-sub whitespace-nowrap
                 overflow-hidden text-ellipsis"
    >
      {title}
    </span>

    <ChevronDown
      size={11}
      class="flex-shrink-0 text-fg-muted transition-transform duration-[180ms]
             {expanded ? 'rotate-180' : ''}"
    />
  </button>

  {#if openFilePath}
    <div class="px-2.5 pb-1.5">
      <a
        href="/files?path={encodeURIComponent(openFilePath)}"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1.5 text-[0.75rem] font-mono text-accent
               no-underline px-1 py-0.5 rounded transition-colors duration-100
               hover:bg-surface-active"
      >
        <FileText size={11} />
        {openFilePath}
        <ExternalLink size={10} />
      </a>
    </div>
  {/if}

  {#if expanded}
    <div class="border-t border-line px-2.5 py-2 flex flex-col gap-0">
      {#if hasArgs}
        <div class="flex flex-col gap-1">
          <span class="text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-fg-muted">
            参数
          </span>
          <pre
            class="m-0 text-[0.73rem] font-mono text-fg-sub whitespace-pre-wrap break-words
                      max-h-[200px] overflow-y-auto rounded-[5px] px-2 py-1.5 leading-[1.5]"
            style="background: var(--code-bg);">{JSON.stringify(call.arguments, null, 2)}</pre>
        </div>
      {/if}

      {#if result}
        <div class="flex flex-col gap-1" class:section-divider={hasArgs}>
          <span
            class="text-[0.7rem] font-semibold uppercase tracking-[0.04em]"
            class:text-fg-muted={!isError}
            class:text-error={isError}
          >
            {isError ? '错误' : '结果'}
          </span>
          {#if generatedImage}
            <div class="flex flex-col gap-1.5">
              <img
                src="data:{generatedImage.mimeType};base64,{generatedImage.imageData}"
                alt={generatedImage.prompt}
                class="block max-w-full rounded-[5px] border border-line"
              />
              <div class="flex items-center justify-between">
                <span class="text-[0.72rem] text-fg-muted font-mono">
                  {generatedImage.aspectRatio} · {generatedImage.imageSize}
                </span>
                <a
                  href="data:{generatedImage.mimeType};base64,{generatedImage.imageData}"
                  download="generated-{result.timestamp ??
                    Date.now()}.{generatedImage.mimeType.split('/')[1] ?? 'png'}"
                  class="inline-flex items-center gap-1 text-[0.75rem] text-accent no-underline
                         px-1.5 py-0.5 rounded transition-colors duration-100 hover:bg-surface-active"
                >
                  <Download size={11} />
                  保存图片
                </a>
              </div>
            </div>
          {:else}
            <pre
              class="m-0 text-[0.73rem] font-mono text-fg-sub whitespace-pre-wrap break-words
                        max-h-[200px] overflow-y-auto rounded-[5px] px-2 py-1.5 leading-[1.5]"
              style="background: var(--code-bg);">{resultText}</pre>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .section-divider {
    border-top: 1px solid var(--border);
    padding-top: 8px;
    margin-top: 8px;
  }
</style>
