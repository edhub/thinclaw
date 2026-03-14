<script lang="ts">
  import { renderMarkdown } from '$lib/utils/markdown'
  import type { AgentMessage } from '$lib/db'
  import type {
    AssistantMessage,
    ToolResultMessage,
    TextContent,
    ThinkingContent,
    ToolCall,
    ImageContent,
  } from '@mariozechner/pi-ai'
  import FileContextCard from '$lib/components/FileContextCard.svelte'
  import type { FileContext } from '$lib/components/FileContextCard.svelte'
  import ToolCard from '$lib/components/ToolCard.svelte'

  interface Props {
    message: AgentMessage
    isStreaming?: boolean
    /** toolCallId → ToolResultMessage, built by the parent from activeMessages */
    toolResultMap?: Map<string, ToolResultMessage>
    /** Called when the user clicks "删除" on an error message. */
    onDelete?: () => void
    /** Called when the user clicks "重试" on an error message. */
    onRetry?: () => void
  }
  let { message, isStreaming = false, toolResultMap, onDelete, onRetry }: Props = $props()

  // --- Derived helpers ---

  const isUser = $derived(message.role === 'user')
  const isAssistant = $derived(message.role === 'assistant')
  const isToolResult = $derived(message.role === 'toolResult')

  // Assistant message content blocks
  const assistantMsg = $derived(isAssistant ? (message as AssistantMessage) : null)
  const textBlocks = $derived(
    assistantMsg?.content.filter((b): b is TextContent => b.type === 'text') ?? [],
  )
  const thinkingBlocks = $derived(
    assistantMsg?.content.filter((b): b is ThinkingContent => b.type === 'thinking') ?? [],
  )
  const toolCallBlocks = $derived(
    assistantMsg?.content.filter((b): b is ToolCall => b.type === 'toolCall') ?? [],
  )

  // User message content
  const userText = $derived(
    message.role === 'user'
      ? typeof message.content === 'string'
        ? message.content
        : message.content
            .filter((b) => b.type === 'text')
            .map((b) => (b as TextContent).text)
            .join('')
      : '',
  )

  // User message images (only present when content is an array)
  const userImages = $derived(
    message.role === 'user' && Array.isArray(message.content)
      ? (message.content as (TextContent | ImageContent)[]).filter(
          (b): b is ImageContent => b.type === 'image',
        )
      : [],
  )

  // Render markdown for assistant text
  let renderedHtml = $state('')
  let thinkingOpen = $state(false)
  /** Whether the collapsed error card is expanded to show the full error message. */
  let errorExpanded = $state(false)

  $effect(() => {
    const combined = textBlocks.map((b) => b.text).join('')
    if (!combined) {
      renderedHtml = ''
      return
    }
    renderMarkdown(combined).then((html) => {
      renderedHtml = html
    })
  })

  // Error state
  const hasError = $derived(
    isAssistant && (assistantMsg?.stopReason === 'error' || !!assistantMsg?.errorMessage),
  )

  // ── File context parsing ──────────────────────────────────────────────────

  /**
   * Parse <file-context> XML blocks out of a user message string.
   * Returns the extracted file blocks and the remaining user text.
   *
   * Format injected by ChatInput:
   *   <file-context path="..." [lines="1-20"] [total="N"] [truncated="true"] [error="true"]>
   *   ...content...
   *   </file-context>
   */
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
</script>

<div
  class="message"
  class:user={isUser}
  class:assistant={isAssistant}
  class:tool-result={isToolResult}
>
  <!-- Avatar -->
  {#if !isToolResult}
    <div class="avatar">
      {#if isUser}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"
          />
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
          />
        </svg>
      {/if}
    </div>
  {/if}

  <!-- Content -->
  <div class="content">
    {#if isUser}
      <!-- User message -->
      {#if userImages.length > 0}
        <div class="user-images">
          {#each userImages as img}
            <img src="data:{img.mimeType};base64,{img.data}" alt="" class="user-image" />
          {/each}
        </div>
      {/if}
      <!-- File context cards (collapsed by default) -->
      {#each parsedUser.files as file}
        <FileContextCard {file} />
      {/each}
      <!-- Actual user question -->
      {#if parsedUser.text}
        <p class="user-text">{parsedUser.text}</p>
      {/if}
    {:else if isAssistant}
      <!-- Thinking block (collapsible) -->
      {#if thinkingBlocks.length > 0}
        <div class="thinking-block">
          <button
            class="thinking-toggle"
            onclick={() => (thinkingOpen = !thinkingOpen)}
            type="button"
          >
            <svg
              class="chevron"
              class:open={thinkingOpen}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>思考过程</span>
            {#if isStreaming && textBlocks.length === 0}
              <span class="thinking-indicator">●</span>
            {/if}
          </button>
          {#if thinkingOpen}
            <div class="thinking-body">
              {#each thinkingBlocks as block}
                <pre class="thinking-text">{block.thinking}</pre>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- Tool calls — merged with their results via ToolCard -->
      {#each toolCallBlocks as call}
        <ToolCard
          {call}
          result={toolResultMap?.get(call.id) ?? null}
          defaultExpanded={call.name === 'generate_image'}
        />
      {/each}

      <!-- Main text -->
      {#if renderedHtml}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="markdown-body">{@html renderedHtml}</div>
      {:else if isStreaming && thinkingBlocks.length === 0 && toolCallBlocks.length === 0}
        <span class="cursor-blink">▋</span>
      {/if}

      <!-- Error card (collapsed by default) -->
      {#if hasError}
        <div class="error-card" class:open={errorExpanded}>
          <div class="error-row">
            <button
              class="error-toggle"
              onclick={() => (errorExpanded = !errorExpanded)}
              type="button"
              aria-expanded={errorExpanded}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="error-icon"
              >
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span class="error-label">请求失败</span>
              <svg
                class="chevron"
                class:open={errorExpanded}
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <div class="error-actions">
              {#if onRetry}
                <button class="error-action-btn" onclick={() => onRetry?.()} type="button" title="删除此条错误并重新发送">
                  ↺ 重试
                </button>
              {/if}
              {#if onDelete}
                <button class="error-action-btn error-action-delete" onclick={() => onDelete?.()} type="button" title="删除此条错误记录">
                  ✕
                </button>
              {/if}
            </div>
          </div>
          {#if errorExpanded}
            <div class="error-body">
              {assistantMsg?.errorMessage ?? '发生未知错误。'}
            </div>
          {/if}
        </div>
      {/if}
    {:else if isToolResult}
      <!-- Tool results are rendered inside ToolCard (within the AssistantMessage above).
           Nothing to render here. -->
    {/if}
  </div>
</div>

<style>
  .message {
    display: flex;
    gap: 12px;
    padding: 14px 0;
    max-width: 100%;
  }

  .message.tool-result {
    display: none; /* ToolResultMessages are now rendered inside ToolCard */
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .user .avatar {
    background: var(--accent);
    color: white;
  }

  .assistant .avatar {
    background: var(--surface-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .content {
    flex: 1;
    min-width: 0;
    padding-top: 3px;
  }

  /* User text */
  .user-text {
    color: var(--text-primary);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  /* User attached images */
  .user-images {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 6px;
  }

  .user-image {
    max-width: 320px;
    max-height: 320px;
    border-radius: 8px;
    border: 1px solid var(--border);
    object-fit: contain;
    display: block;
    cursor: zoom-in;
  }

  /* Thinking block */
  .thinking-block {
    margin-bottom: 10px;
  }

  .thinking-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.78rem;
    color: var(--text-muted);
    padding: 3px 0;
    border-radius: 4px;
    transition: color 0.1s;
  }

  .thinking-toggle:hover {
    color: var(--text-secondary);
  }

  .chevron {
    transition: transform 0.2s;
    flex-shrink: 0;
  }
  .chevron.open {
    transform: rotate(90deg);
  }

  .thinking-indicator {
    color: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
    font-size: 0.7rem;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }

  .thinking-body {
    margin-top: 6px;
    border-left: 2px solid var(--border);
    padding-left: 10px;
  }

  .thinking-text {
    font-size: 0.8rem;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    line-height: 1.5;
    margin: 0;
  }

  /* Error card (collapsed by default) */
  .error-card {
    border: 1px solid var(--error);
    border-radius: 7px;
    margin-top: 6px;
    overflow: hidden;
    background: var(--error-bg);
  }

  .error-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .error-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 7px 10px;
    text-align: left;
    color: var(--error);
    font-size: 0.8rem;
    border-radius: 7px;
    transition: background 0.1s;
  }

  .error-toggle:hover {
    background: color-mix(in srgb, var(--error) 10%, transparent);
  }

  .error-card.open .error-toggle {
    border-radius: 7px 7px 0 0;
  }

  .error-icon {
    flex-shrink: 0;
    opacity: 0.85;
  }

  .error-label {
    flex: 1;
    font-weight: 500;
  }

  .error-card .chevron {
    flex-shrink: 0;
    color: var(--error);
    opacity: 0.7;
    transition: transform 0.18s;
    transform: rotate(0deg);
  }

  .error-card .chevron.open {
    transform: rotate(90deg);
  }

  .error-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    padding-right: 6px;
    flex-shrink: 0;
  }

  .error-action-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 5px;
    font-size: 0.75rem;
    color: var(--error);
    opacity: 0.8;
    transition: all 0.1s;
    white-space: nowrap;
  }

  .error-action-btn:hover {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    opacity: 1;
  }

  .error-action-delete {
    opacity: 0.5;
  }

  .error-body {
    padding: 8px 12px 10px;
    font-size: 0.8rem;
    color: var(--error);
    opacity: 0.9;
    line-height: 1.55;
    border-top: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Markdown body — typography rules are in app.css */
  .markdown-body {
    color: var(--text-primary);
    line-height: 1.7;
    font-size: 0.9375rem;
    word-break: break-word;
  }

  .cursor-blink {
    display: inline-block;
    animation: blink 1s step-end infinite;
    color: var(--accent);
  }

  @keyframes blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0;
    }
  }
</style>
