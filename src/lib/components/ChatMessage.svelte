<script lang="ts">
  import { renderMarkdown } from '$lib/utils/markdown';
  import type { Message } from '$lib/db';

  interface Props {
    message: Message;
    isStreaming?: boolean;
  }
  let { message, isStreaming = false }: Props = $props();

  let renderedHtml = $state('');

  $effect(() => {
    if (message.role !== 'assistant') return;
    renderMarkdown(message.content).then((html) => {
      renderedHtml = html;
    });
  });
</script>

<div class="message" class:user={message.role === 'user'} class:assistant={message.role === 'assistant'}>
  <div class="avatar">
    {#if message.role === 'user'}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
      </svg>
    {:else}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
      </svg>
    {/if}
  </div>

  <div class="content">
    {#if message.role === 'user'}
      <p class="user-text">{message.content}</p>
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      <div class="markdown-body">{@html renderedHtml}</div>
      {#if isStreaming && message.content === ''}
        <span class="cursor-blink">▋</span>
      {/if}
    {/if}
  </div>
</div>

<style>
  .message {
    display: flex;
    gap: 12px;
    padding: 16px 0;
    max-width: 100%;
  }

  .avatar {
    width: 30px;
    height: 30px;
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
    padding-top: 4px;
  }

  .user-text {
    color: var(--text-primary);
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  /* Markdown body styles */
  .markdown-body {
    color: var(--text-primary);
    line-height: 1.7;
    font-size: 0.9375rem;
    word-break: break-word;
  }

  :global(.markdown-body p) { margin: 0 0 0.75em; }
  :global(.markdown-body p:last-child) { margin-bottom: 0; }
  :global(.markdown-body h1, .markdown-body h2, .markdown-body h3) {
    font-weight: 600;
    margin: 1.25em 0 0.5em;
    line-height: 1.3;
    color: var(--text-primary);
  }
  :global(.markdown-body h1) { font-size: 1.4em; }
  :global(.markdown-body h2) { font-size: 1.2em; }
  :global(.markdown-body h3) { font-size: 1.05em; }
  :global(.markdown-body ul, .markdown-body ol) { padding-left: 1.5em; margin: 0.5em 0; }
  :global(.markdown-body li) { margin: 0.25em 0; }
  :global(.markdown-body pre) {
    background: var(--code-bg);
    border-radius: 8px;
    padding: 12px 16px;
    overflow-x: auto;
    margin: 0.75em 0;
    font-size: 0.875em;
    border: 1px solid var(--border);
  }
  :global(.markdown-body code) {
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.875em;
  }
  :global(.markdown-body p code, .markdown-body li code) {
    background: var(--code-inline-bg);
    padding: 2px 5px;
    border-radius: 4px;
    color: var(--code-inline-color);
  }
  :global(.markdown-body blockquote) {
    border-left: 3px solid var(--accent);
    padding-left: 1em;
    margin: 0.75em 0;
    color: var(--text-secondary);
  }
  :global(.markdown-body table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
    font-size: 0.9em;
  }
  :global(.markdown-body th, .markdown-body td) {
    border: 1px solid var(--border);
    padding: 6px 12px;
    text-align: left;
  }
  :global(.markdown-body th) {
    background: var(--surface-elevated);
    font-weight: 600;
  }
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
