<script lang="ts">
  import { User, Bot, ChevronRight, AlertTriangle, RotateCcw, X } from 'lucide-svelte'
  import type { AgentMessage } from '@mariozechner/pi-agent-core'
  import type {
    TextContent,
    ThinkingContent,
    ImageContent,
    ToolCall,
    ToolResultMessage,
    UserMessage,
    AssistantMessage,
  } from '@mariozechner/pi-ai'
  import { renderMarkdown } from '$lib/utils/markdown'
  import ToolCard from '$lib/components/ToolCard.svelte'
  import FileContextCard from '$lib/components/FileContextCard.svelte'

  interface Props {
    message: AgentMessage
    isStreaming: boolean
    toolResultMap?: Map<string, ToolResultMessage>
    onDelete?: () => void
    onRetry?: () => void
  }
  let { message, isStreaming, toolResultMap, onDelete, onRetry }: Props = $props()

  const isUser = $derived(message.role === 'user')
  const isAssistant = $derived(message.role === 'assistant')
  const isToolResult = $derived(message.role === 'toolResult')

  const assistantMsg = $derived(isAssistant ? (message as AssistantMessage) : null)

  const userText = $derived(
    isUser
      ? (() => {
          const c = (message as UserMessage).content
          if (typeof c === 'string') return c
          return c
            .filter((b): b is TextContent => b.type === 'text')
            .map((b) => b.text)
            .join('')
        })()
      : '',
  )

  const userImages = $derived(
    isUser
      ? (() => {
          const c = (message as UserMessage).content
          if (typeof c === 'string') return [] as ImageContent[]
          return c.filter((b): b is ImageContent => b.type === 'image')
        })()
      : ([] as ImageContent[]),
  )

  const thinkingBlocks = $derived(
    isAssistant
      ? (message as AssistantMessage).content.filter(
          (b): b is ThinkingContent => b.type === 'thinking',
        )
      : [],
  )

  const textBlocks = $derived(
    isAssistant
      ? (message as AssistantMessage).content.filter((b): b is TextContent => b.type === 'text')
      : [],
  )

  const toolCallBlocks = $derived(
    isAssistant
      ? (message as AssistantMessage).content.filter((b): b is ToolCall => b.type === 'toolCall')
      : [],
  )

  let thinkingOpen = $state(false)
  let errorExpanded = $state(false)
  let renderedHtml = $state('')

  $effect(() => {
    if (isStreaming) return
    const combined = textBlocks.map((b) => b.text).join('')
    if (!combined) {
      renderedHtml = ''
      return
    }
    renderMarkdown(combined).then((html) => {
      renderedHtml = html
    })
  })

  const hasError = $derived(
    isAssistant && (assistantMsg?.stopReason === 'error' || !!assistantMsg?.errorMessage),
  )

  // ── File context ──────────────────────────────────────────────────────────
  import type { FileContext } from '$lib/components/FileContextCard.svelte'

  function parseUserMessage(raw: string): { files: FileContext[]; text: string } {
    const files: FileContext[] = []
    const cleaned = raw.replace(
      /<file-context([^>]*)>([\s\S]*?)<\/file-context>/g,
      (_, attrs: string, body: string) => {
        files.push({
          path: /path="([^"]*)"/.exec(attrs)?.[1] ?? '',
          lines: /lines="([^"]*)"/.exec(attrs)?.[1],
          total: parseInt(/total="(\d+)"/.exec(attrs)?.[1] ?? '0', 10) || undefined,
          truncated: /truncated="true"/.test(attrs),
          error: /error="true"/.test(attrs),
          content: body.trim(),
        })
        return ''
      },
    )
    return { files, text: cleaned.trim() }
  }

  const parsedUser = $derived(isUser ? parseUserMessage(userText) : { files: [], text: userText })

  // ── Metadata helpers ──────────────────────────────────────────────────────
  function formatTime(ts: number): string {
    const d = new Date(ts)
    const now = new Date()
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    const time = `${h}:${m}`
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    if (sameDay) return time
    const mo = (d.getMonth() + 1).toString().padStart(2, '0')
    const dy = d.getDate().toString().padStart(2, '0')
    return `${mo}-${dy} ${time}`
  }

  function formatTokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  }

  const msgTimestamp = $derived((message as any).timestamp as number | undefined)
  const usage = $derived(assistantMsg?.usage)
</script>

<!-- tool-result messages are rendered inside ToolCard — skip entirely -->
{#if !isToolResult}
  <div
    class="flex flex-col gap-2 py-[18px] border-b max-w-full
         border-[color-mix(in_srgb,var(--border)_50%,transparent)]
         last:border-b-0"
  >
    <!-- Header -->
    <div class="flex items-center gap-1.5 min-h-[22px]">
      <!-- Avatar -->
      <div
        class="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0"
        class:user-av={isUser}
        class:asst-av={isAssistant}
      >
        {#if isUser}<User size={13} />{:else}<Bot size={13} />{/if}
      </div>

      <span class="text-[0.75rem] font-semibold text-fg-muted leading-none">
        {isUser ? '你' : 'ThinClaw'}
      </span>

      <!-- Metadata -->
      <div class="flex items-center gap-1.5 ml-auto flex-shrink-0 opacity-50">
        {#if msgTimestamp}
          <span class="text-[0.7rem] text-fg-muted leading-none whitespace-nowrap">
            {formatTime(msgTimestamp)}
          </span>
        {/if}
        {#if isAssistant && !isStreaming && usage && (usage.input > 0 || usage.output > 0)}
          {@const hasCacheRead = (usage.cacheRead ?? 0) > 0}
          {@const hasCacheWrite = (usage.cacheWrite ?? 0) > 0}
          <span
            class="text-[0.7rem] text-fg-muted leading-none whitespace-nowrap tabular-nums"
            title="输入 {usage.input} · 输出 {usage.output}{hasCacheRead
              ? ` · 缓存命中 ${usage.cacheRead}`
              : ''}${hasCacheWrite ? ` · 缓存写入 ${usage.cacheWrite}` : ''} tokens"
          >
            ↑{formatTokens(usage.input)}&nbsp;↓{formatTokens(usage.output)}{hasCacheRead
              ? `\u00a0⚡${formatTokens(usage.cacheRead)}`
              : ''}{hasCacheWrite ? `\u00a0✎${formatTokens(usage.cacheWrite)}` : ''}
          </span>
          <span class="text-line text-[0.72rem] leading-none select-none">·</span>
        {/if}
      </div>
    </div>

    <!-- Content -->
    <div class="min-w-0">
      {#if isUser}
        {#if userImages.length > 0}
          <div class="flex flex-wrap gap-2 mb-1.5">
            {#each userImages as img}
              <img
                src="data:{img.mimeType};base64,{img.data}"
                alt=""
                class="max-w-[320px] max-h-[320px] rounded-lg border border-line
                     object-contain block cursor-zoom-in"
              />
            {/each}
          </div>
        {/if}
        {#each parsedUser.files as file}
          <FileContextCard {file} />
        {/each}
        {#if parsedUser.text}
          <p class="text-fg leading-relaxed whitespace-pre-wrap break-words m-0">
            {parsedUser.text}
          </p>
        {/if}
      {:else if isAssistant}
        <!-- Thinking block -->
        {#if thinkingBlocks.length > 0}
          <div class="mb-2.5">
            <button
              class="inline-flex items-center gap-1.5 bg-transparent border-none cursor-pointer
                   text-[0.78rem] text-fg-muted py-0.5 rounded-md
                   hover:text-fg-sub transition-colors duration-100"
              onclick={() => (thinkingOpen = !thinkingOpen)}
              type="button"
            >
              <ChevronRight
                size={12}
                class="transition-transform duration-200 flex-shrink-0
                     {thinkingOpen ? 'rotate-90' : ''}"
              />
              <span>思考过程</span>
              {#if isStreaming && textBlocks.length === 0}
                <span class="text-accent text-[0.7rem] animate-pulse-soft">●</span>
              {/if}
            </button>
            {#if thinkingOpen}
              <div class="mt-1.5 border-l-2 border-line pl-2.5">
                {#each thinkingBlocks as block}
                  <pre
                    class="text-[0.8rem] text-fg-muted whitespace-pre-wrap break-words
                             font-[inherit] leading-[1.5] m-0">{block.thinking}</pre>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Tool calls -->
        {#each toolCallBlocks as call}
          <ToolCard
            {call}
            result={toolResultMap?.get(call.id) ?? null}
            defaultExpanded={call.name === 'generate_image'}
          />
        {/each}

        <!-- Text -->
        {#if isStreaming && textBlocks.length > 0}
          <div class="text-fg leading-[1.7] text-[0.9375rem] break-words whitespace-pre-wrap">
            {textBlocks.map((b) => b.text).join('')}
          </div>
        {:else if renderedHtml}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="markdown-body text-fg leading-[1.7] text-[0.9375rem] break-words">
            {@html renderedHtml}
          </div>
        {:else if isStreaming && thinkingBlocks.length === 0 && toolCallBlocks.length === 0}
          <span class="inline-block text-accent animate-blink">▋</span>
        {/if}

        <!-- Error card -->
        {#if hasError}
          <div
            class="error-card border border-error rounded-[7px] mt-1.5 overflow-hidden bg-error-bg"
            class:open={errorExpanded}
          >
            <div class="flex items-center gap-1">
              <button
                class="flex-1 flex items-center gap-1.5 bg-transparent border-none cursor-pointer
                     px-2.5 py-1.5 text-left text-error text-[0.8rem] rounded-[7px]
                     transition-colors duration-100
                     hover:bg-[color-mix(in_srgb,var(--error)_10%,transparent)]"
                onclick={() => (errorExpanded = !errorExpanded)}
                type="button"
                aria-expanded={errorExpanded}
              >
                <AlertTriangle size={12} class="flex-shrink-0 opacity-85" />
                <span class="flex-1 font-medium">请求失败</span>
                <ChevronRight
                  size={10}
                  class="flex-shrink-0 text-error opacity-70 transition-transform duration-[180ms]
                       {errorExpanded ? 'rotate-90' : ''}"
                />
              </button>
              <div class="flex items-center gap-0.5 pr-1.5 flex-shrink-0">
                {#if onRetry}
                  <button
                    class="inline-flex items-center gap-1 bg-transparent border-none cursor-pointer
                         px-2 py-1 rounded-[5px] text-[0.75rem] text-error opacity-80
                         whitespace-nowrap transition-all duration-100
                         hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)] hover:opacity-100"
                    onclick={() => onRetry?.()}
                    type="button"
                    title="删除此条错误并重新发送"
                  >
                    <RotateCcw size={11} /> 重试
                  </button>
                {/if}
                {#if onDelete}
                  <button
                    class="inline-flex items-center bg-transparent border-none cursor-pointer
                         px-2 py-1 rounded-[5px] text-error opacity-50
                         transition-all duration-100
                         hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)] hover:opacity-100"
                    onclick={() => onDelete?.()}
                    type="button"
                    title="删除此条错误记录"
                  >
                    <X size={12} />
                  </button>
                {/if}
              </div>
            </div>
            {#if errorExpanded}
              <div
                class="px-3 py-2 text-[0.8rem] text-error opacity-90 leading-[1.55]
                     border-t whitespace-pre-wrap break-words"
                style="border-color: color-mix(in srgb, var(--error) 30%, transparent)"
              >
                {assistantMsg?.errorMessage ?? '发生未知错误。'}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Avatar color variants */
  .user-av {
    background: var(--accent);
    color: white;
  }
  .asst-av {
    background: var(--surface-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  /* error-card: when open, round only the toggle top corners */
  .error-card.open button:first-of-type {
    border-radius: 7px 7px 0 0;
  }
</style>
