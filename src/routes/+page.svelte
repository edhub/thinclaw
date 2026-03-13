<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import ChatMessage from '$lib/components/ChatMessage.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import Settings from '$lib/components/Settings.svelte';
  import ModelSwitcher from '$lib/components/ModelSwitcher.svelte';
  import PersonaPicker from '$lib/components/PersonaPicker.svelte';
  import {
    loadConversations,
    selectConversation,
    sendMessage,
    createConversation,
    activeMessages,
    streamingMessage,
    pendingUserMessage,
    activeConversationId,
    activeConversation,
    conversations,
    isStreaming,
    streamError,
    abortStreaming,
    compactionStatus,
  } from '$lib/stores/chat';
  import { get } from 'svelte/store';
  import { nanoid } from '$lib/utils/nanoid';
  import type { AgentMessage } from '@mariozechner/pi-agent-core';

  // Assign a stable random key to each message object on first encounter.
  // Using WeakMap avoids memory leaks — keys are GC'd with their message objects.
  const msgKeys = new WeakMap<AgentMessage, string>();
  function keyOf(msg: AgentMessage): string {
    let k = msgKeys.get(msg);
    if (!k) { k = nanoid(); msgKeys.set(msg, k); }
    return k;
  }
  import type { ImageContent } from '@mariozechner/pi-ai';
  import { memories } from '$lib/stores/memory';

  import { settings } from '$lib/stores/settings';
  import { sweepSessions } from '$lib/fs/session-recorder';

  let showSettings = $state(false);
  let sidebarOpen = $state(false);
  let chatEndEl = $state<HTMLDivElement | undefined>(undefined);
  let chatInputRef = $state<{ focus: () => void } | undefined>(undefined);

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if ($activeConversationId) {
        chatInputRef?.focus();
      } else {
        createConversation();
        tick().then(() => chatInputRef?.focus());
      }
    }
  }

  onMount(async () => {
    document.addEventListener('keydown', handleGlobalKeydown);

    // Sweep expired session files once per browser session (non-blocking).
    sweepSessions().catch(() => {});
    // Load memories once at startup. The memory_save / memory_delete tools
    // keep the store in sync incrementally — no need to reload on every agent turn.
    await memories.load();
    await loadConversations();
    // Auto-open the most recent conversation on startup.
    const list = get(conversations);
    if (list.length > 0) await selectConversation(list[0].id);
  });

  onDestroy(() => document.removeEventListener('keydown', handleGlobalKeydown));

  // Auto-scroll when messages or streaming message change
  $effect(() => {
    const _a = $activeMessages.length;
    const _b = $streamingMessage;
    const _c = $pendingUserMessage;
    void _a; void _b; void _c;
    const behavior = $streamingMessage ? 'instant' : 'smooth';
    chatEndEl?.scrollIntoView({ behavior, block: 'end' });
  });

  async function handleSend(content: string, images: ImageContent[]) {
    await sendMessage(content, images);
  }

  // Apply theme
  $effect(() => {
    const theme = $settings.theme;
    const root = document.documentElement;
    if (theme === 'dark') root.setAttribute('data-theme', 'dark');
    else if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  });


</script>

<svelte:head>
  <title>ThinClaw</title>
</svelte:head>

<div class="app-shell">
  <!-- Mobile backdrop (shown when sidebar is open) -->
  {#if sidebarOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="mobile-backdrop"
      role="presentation"
      onclick={() => (sidebarOpen = false)}
    ></div>
  {/if}

  <Sidebar
    onOpenSettings={() => (showSettings = true)}
    open={sidebarOpen}
    onClose={() => (sidebarOpen = false)}
  />

  <main class="chat-area">
    <!-- Mobile-only top bar -->
    <header class="mobile-header">
      <button class="btn-hamburger" onclick={() => (sidebarOpen = true)} aria-label="打开侧边栏">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <span class="mobile-title">
        {$activeConversation?.title ?? 'ThinClaw'}
      </span>
      <ModelSwitcher />
      <button class="btn-mobile-settings" onclick={() => (showSettings = true)} aria-label="设置">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
    </header>

    <!-- Desktop: floating controls in top-right corner -->
    <div class="chat-controls">
      <ModelSwitcher />
      <button class="btn-settings" onclick={() => (showSettings = true)} aria-label="设置">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
    </div>

    {#if !$activeConversationId}
      <!-- Welcome screen -->
      <div class="welcome">
        <div class="welcome-icon">🦀</div>
        <h1>ThinClaw</h1>
        <p>一款完全在浏览器中运行的轻量级 AI 聊天应用。</p>
        {#if !$settings.apiKey}
          <p class="warn">
            未设置 API 密钥。
            <button onclick={() => (showSettings = true)}>打开设置</button>
            以添加您的密钥。
          </p>
        {:else}
          <button class="btn-start" onclick={() => createConversation()}>
            开始对话
          </button>
        {/if}
      </div>
    {:else}
      <!-- Chat thread -->
      <div class="messages">
        <div class="messages-inner">
          <!-- Persona picker: shown only while the conversation has no messages -->
          {#if $activeMessages.length === 0 && !$isStreaming && !$pendingUserMessage}
            <PersonaPicker />
          {/if}

          <!-- Persisted messages -->
          {#each $activeMessages as msg, i (keyOf(msg))}
            <ChatMessage message={msg} isStreaming={false} />
          {/each}

          <!-- Optimistic user message shown immediately on send -->
          {#if $pendingUserMessage}
            <ChatMessage message={$pendingUserMessage} isStreaming={false} />
          {/if}

          <!-- Loading placeholder: request is in-flight but no streaming chunk yet -->
          {#if $isStreaming && !$streamingMessage}
            <div class="ai-loading">
              <div class="ai-loading-avatar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/>
                </svg>
              </div>
              <div class="ai-loading-dots">
                <span></span><span></span><span></span>
              </div>
            </div>
          {/if}

          <!-- In-flight streaming message -->
          {#if $streamingMessage}
            <ChatMessage message={$streamingMessage} isStreaming={true} />
          {/if}

          {#if $streamError}
            <div class="error-banner">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {$streamError}
            </div>
          {/if}

          <div bind:this={chatEndEl}></div>
        </div>
      </div>

      <ChatInput bind:this={chatInputRef} onSend={handleSend} onAbort={abortStreaming} />

      {#if $compactionStatus === 'compacting'}
        <div class="compaction-banner">
          <span class="compaction-spinner"></span>
          正在压缩对话历史…
        </div>
      {/if}
    {/if}
  </main>
</div>

{#if showSettings}
  <Settings onClose={() => (showSettings = false)} />
{/if}

<style>
  .app-shell {
    display: flex;
    height: 100vh;
    overflow: hidden;
    background: var(--surface-main);
  }

  .chat-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    position: relative;
  }

  /* Welcome */
  .welcome {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    text-align: center;
    color: var(--text-primary);
  }

  .welcome-icon { font-size: 3rem; }

  .welcome h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.02em;
  }

  .welcome p { color: var(--text-secondary); margin: 0; font-size: 1rem; }

  .warn {
    background: var(--warn-bg, var(--error-bg));
    color: var(--warn-color, var(--error));
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 0.9rem !important;
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .warn button {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.9rem;
    text-decoration: underline;
    padding: 0;
  }

  .btn-start {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 10px;
    padding: 10px 24px;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    margin-top: 8px;
    transition: opacity 0.1s;
  }
  .btn-start:hover { opacity: 0.85; }

  /* Messages */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 0 24px;
  }

  .messages-inner {
    max-width: 740px;
    margin: 0 auto;
    padding: 24px 0;
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--error-bg);
    color: var(--error);
    border: 1px solid var(--error);
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 0.875rem;
    margin: 8px 0;
  }

  /* AI response loading placeholder */
  .ai-loading {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 0;
  }

  .ai-loading-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--surface-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .ai-loading-dots {
    display: flex;
    align-items: center;
    gap: 5px;
    padding-top: 3px;
  }

  .ai-loading-dots span {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
    animation: ai-dot-bounce 1.2s ease-in-out infinite;
  }

  .ai-loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .ai-loading-dots span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes ai-dot-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40% { transform: translateY(-5px); opacity: 1; }
  }

  .compaction-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 16px;
    font-size: 0.8rem;
    color: var(--text-muted);
    border-top: 1px solid var(--border);
    background: var(--surface-main);
  }

  .compaction-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* ── Mobile backdrop ── */
  .mobile-backdrop {
    display: none;
  }

  /* ── Desktop floating controls (top-right, no layout row) ── */
  .chat-controls {
    position: absolute;
    top: 10px;
    right: 14px;
    display: flex;
    align-items: center;
    gap: 6px;
    z-index: 10;
  }

  .btn-settings {
    background: none;
    border: none;
    padding: 6px;
    border-radius: 8px;
    cursor: pointer;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    transition: all 0.1s;
    flex-shrink: 0;
  }
  .btn-settings:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  /* ── Mobile header (hidden on desktop) ── */
  .mobile-header {
    display: none;
  }

  @media (max-width: 639px) {
    /* Backdrop behind the sidebar drawer */
    .mobile-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      z-index: 40;
    }

    /* Hide desktop header on mobile */
    /* On mobile, hide the floating desktop controls */
    .chat-controls {
      display: none;
    }

    /* Top bar replaces the sidebar brand on mobile */
    .mobile-header {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 52px;
      padding: 0 8px 0 12px;
      border-bottom: 1px solid var(--border);
      background: var(--surface-main);
      flex-shrink: 0;
    }

    .mobile-title {
      flex: 1;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: center;
    }

    .btn-hamburger,
    .btn-mobile-settings {
      background: none;
      border: none;
      padding: 6px;
      border-radius: 8px;
      cursor: pointer;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      flex-shrink: 0;
      transition: all 0.1s;
    }
    .btn-hamburger:hover,
    .btn-mobile-settings:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
    }

    /* Reduce chat area horizontal padding on mobile */
    .messages {
      padding: 0 12px;
    }

    .messages-inner {
      padding: 16px 0;
    }
  }
</style>
