<script lang="ts">
  import { renderMarkdown } from '$lib/utils/markdown';
  import type { AgentMessage } from '$lib/db';
  import type {
    AssistantMessage,
    ToolResultMessage,
    TextContent,
    ThinkingContent,
    ToolCall,
    ImageContent,
  } from '@mariozechner/pi-ai';

  interface Props {
    message: AgentMessage;
    isStreaming?: boolean;
  }
  let { message, isStreaming = false }: Props = $props();

  // --- Derived helpers ---

  const isUser = $derived(message.role === 'user');
  const isAssistant = $derived(message.role === 'assistant');
  const isToolResult = $derived(message.role === 'toolResult');

  // Assistant message content blocks
  const assistantMsg = $derived(isAssistant ? (message as AssistantMessage) : null);
  const textBlocks = $derived(
    assistantMsg?.content.filter((b): b is TextContent => b.type === 'text') ?? [],
  );
  const thinkingBlocks = $derived(
    assistantMsg?.content.filter((b): b is ThinkingContent => b.type === 'thinking') ?? [],
  );
  const toolCallBlocks = $derived(
    assistantMsg?.content.filter((b): b is ToolCall => b.type === 'toolCall') ?? [],
  );

  // Tool result
  const toolResultMsg = $derived(isToolResult ? (message as ToolResultMessage) : null);

  // For fs_write / fs_edit / fs_move results: extract a file path to offer "Open" link
  const openFilePath = $derived((() => {
    if (!toolResultMsg || toolResultMsg.isError) return null;
    const text = toolResultMsg.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as TextContent).text)
      .join('');
    switch (toolResultMsg.toolName) {
      case 'fs_write': { const m = text.match(/^Written: (.+?) \(/); return m?.[1] ?? null; }
      case 'fs_edit':  { const m = text.match(/^Edited: (.+)$/m);    return m?.[1]?.trim() ?? null; }
      case 'fs_move':  { const m = text.match(/→ (.+)$/m);           return m?.[1]?.trim() ?? null; }
      default: return null;
    }
  })());

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
  );

  // User message images (only present when content is an array)
  const userImages = $derived(
    message.role === 'user' && Array.isArray(message.content)
      ? (message.content as (TextContent | ImageContent)[]).filter(
          (b): b is ImageContent => b.type === 'image',
        )
      : [],
  );

  // Render markdown for assistant text
  let renderedHtml = $state('');
  let thinkingOpen = $state(false);

  $effect(() => {
    const combined = textBlocks.map((b) => b.text).join('');
    if (!combined) { renderedHtml = ''; return; }
    renderMarkdown(combined).then((html) => { renderedHtml = html; });
  });

  // Error state
  const hasError = $derived(
    isAssistant && (assistantMsg?.stopReason === 'error' || !!assistantMsg?.errorMessage),
  );
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
          <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
        </svg>
      {/if}
    </div>
  {/if}

  <!-- Content -->
  <div class="content" class:content-tool={isToolResult}>

    {#if isUser}
      <!-- User message -->
      {#if userImages.length > 0}
        <div class="user-images">
          {#each userImages as img}
            <img
              src="data:{img.mimeType};base64,{img.data}"
              alt=""
              class="user-image"
            />
          {/each}
        </div>
      {/if}
      {#if userText}
        <p class="user-text">{userText}</p>
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
              width="12" height="12" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2.5"
            >
              <polyline points="9 18 15 12 9 6"/>
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

      <!-- Tool calls (pending or completed) -->
      {#each toolCallBlocks as call}
        <div class="tool-call-card">
          <div class="tool-call-header">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
            </svg>
            <span class="tool-name">{call.name}</span>
            <span class="tool-status-badge">调用中…</span>
          </div>
          <pre class="tool-args">{JSON.stringify(call.arguments, null, 2)}</pre>
        </div>
      {/each}

      <!-- Main text -->
      {#if renderedHtml}
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="markdown-body">{@html renderedHtml}</div>
      {:else if isStreaming && thinkingBlocks.length === 0 && toolCallBlocks.length === 0}
        <span class="cursor-blink">▋</span>
      {/if}

      <!-- Error -->
      {#if hasError}
        <div class="error-inline">
          {assistantMsg?.errorMessage ?? '发生错误。'}
        </div>
      {/if}

    {:else if isToolResult}
      <!-- Tool result card -->
      <div class="tool-result-card" class:error={toolResultMsg?.isError}>
        <div class="tool-result-header">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            {#if toolResultMsg?.isError}
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            {:else}
              <polyline points="20 6 9 17 4 12"/>
            {/if}
          </svg>
          <span class="tool-name">{toolResultMsg?.toolName ?? 'tool'}</span>
        </div>
        <pre class="tool-result-text">{toolResultMsg?.content
          .filter((c) => c.type === 'text')
          .map((c) => (c as TextContent).text)
          .join('\n')}</pre>
        {#if openFilePath}
          <div class="tool-result-open">
            <a
              href="/files?path={encodeURIComponent(openFilePath)}"
              target="_blank"
              rel="noopener noreferrer"
              class="open-file-link"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
              {openFilePath}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </div>
        {/if}
      </div>
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
    padding: 4px 0 4px 42px; /* indent under assistant */
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

  .content-tool {
    padding-top: 0;
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

  .thinking-toggle:hover { color: var(--text-secondary); }

  .chevron {
    transition: transform 0.2s;
    flex-shrink: 0;
  }
  .chevron.open { transform: rotate(90deg); }

  .thinking-indicator {
    color: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
    font-size: 0.7rem;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
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

  /* Tool call card */
  .tool-call-card {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
  }

  .tool-call-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 0.8rem;
  }

  .tool-name {
    font-weight: 500;
    font-family: monospace;
    flex: 1;
  }

  .tool-status-badge {
    font-size: 0.7rem;
    background: var(--surface-hover);
    border-radius: 4px;
    padding: 2px 6px;
    color: var(--text-muted);
  }

  .tool-args {
    font-size: 0.75rem;
    color: var(--text-secondary);
    padding: 8px 10px;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 120px;
    overflow-y: auto;
    font-family: monospace;
  }

  /* Tool result card */
  .tool-result-card {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    font-size: 0.8rem;
  }

  .tool-result-card.error {
    border-color: var(--error);
  }

  .tool-result-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    background: var(--surface-hover);
  }

  .tool-result-card.error .tool-result-header {
    color: var(--error);
    background: var(--error-bg);
  }

  .tool-result-text {
    margin: 0;
    padding: 8px 10px;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    font-family: monospace;
    max-height: 200px;
    overflow-y: auto;
  }

  .tool-result-open {
    padding: 6px 10px;
    border-top: 1px solid var(--border);
  }

  .open-file-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.78rem;
    color: var(--accent);
    text-decoration: none;
    font-family: monospace;
    border-radius: 4px;
    padding: 2px 4px;
    transition: background 0.1s;
  }
  .open-file-link:hover {
    background: var(--surface-active);
  }

  /* Error inline */
  .error-inline {
    color: var(--error);
    font-size: 0.875rem;
    padding: 6px 10px;
    background: var(--error-bg);
    border-radius: 6px;
    margin-top: 4px;
  }

  /* Markdown body */
  .markdown-body {
    color: var(--text-primary);
    line-height: 1.7;
    font-size: 0.9375rem;
    word-break: break-word;
  }

  :global(.markdown-body p) { margin: 0 0 0.75em; }
  :global(.markdown-body p:last-child) { margin-bottom: 0; }
  :global(.markdown-body h1, .markdown-body h2, .markdown-body h3) {
    font-weight: 600; margin: 1.25em 0 0.5em; line-height: 1.3; color: var(--text-primary);
  }
  :global(.markdown-body h1) { font-size: 1.4em; }
  :global(.markdown-body h2) { font-size: 1.2em; }
  :global(.markdown-body h3) { font-size: 1.05em; }
  :global(.markdown-body ul, .markdown-body ol) { padding-left: 1.5em; margin: 0.5em 0; }
  :global(.markdown-body li) { margin: 0.25em 0; }
  :global(.markdown-body pre) {
    background: var(--code-bg); border-radius: 8px; padding: 12px 16px;
    overflow-x: auto; margin: 0.75em 0; font-size: 0.875em; border: 1px solid var(--border);
  }
  :global(.markdown-body code) {
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace; font-size: 0.875em;
  }
  :global(.markdown-body p code, .markdown-body li code) {
    background: var(--code-inline-bg); padding: 2px 5px; border-radius: 4px;
    color: var(--code-inline-color);
  }
  :global(.markdown-body blockquote) {
    border-left: 3px solid var(--accent); padding-left: 1em;
    margin: 0.75em 0; color: var(--text-secondary);
  }
  :global(.markdown-body table) { border-collapse: collapse; width: 100%; margin: 0.75em 0; font-size: 0.9em; }
  :global(.markdown-body th, .markdown-body td) {
    border: 1px solid var(--border); padding: 6px 12px; text-align: left;
  }
  :global(.markdown-body th) { background: var(--surface-elevated); font-weight: 600; }
  :global(.markdown-body a) { color: var(--accent); text-decoration: underline; }
  :global(.markdown-body hr) { border: none; border-top: 1px solid var(--border); margin: 1em 0; }

  .cursor-blink {
    display: inline-block;
    animation: blink 1s step-end infinite;
    color: var(--accent);
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
</style>
