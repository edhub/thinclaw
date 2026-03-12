<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import ChatMessage from '$lib/components/ChatMessage.svelte';
  import ChatInput from '$lib/components/ChatInput.svelte';
  import Settings from '$lib/components/Settings.svelte';
  import {
    loadConversations,
    sendMessage,
    createConversation,
    activeMessages,
    streamingMessage,
    activeConversationId,
    activeConversation,
    isStreaming,
    streamError,
    abortStreaming,
    compactionStatus,
  } from '$lib/stores/chat';
  import type { ImageContent } from '@mariozechner/pi-ai';
  import { memories } from '$lib/stores/memory';

  import { settings } from '$lib/stores/settings';

  let showSettings = $state(false);
  let sidebarOpen = $state(false);
  let chatEndEl = $state<HTMLDivElement | undefined>(undefined);

  onMount(async () => {
    // Load memories once at startup. The memory_save / memory_delete tools
    // keep the store in sync incrementally — no need to reload on every agent turn.
    await memories.load();
    await loadConversations();
  });

  // Auto-scroll when messages or streaming message change
  $effect(() => {
    const _a = $activeMessages.length;
    const _b = $streamingMessage;
    void _a; void _b;
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
      <button class="btn-hamburger" onclick={() => (sidebarOpen = true)} aria-label="Open sidebar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <span class="mobile-title">
        {$activeConversation?.title ?? 'ThinClaw'}
      </span>
      <button class="btn-mobile-settings" onclick={() => (showSettings = true)} aria-label="Settings">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      </button>
    </header>

    {#if !$activeConversationId}
      <!-- Welcome screen -->
      <div class="welcome">
        <div class="welcome-icon">🦀</div>
        <h1>ThinClaw</h1>
        <p>A lightweight AI chat that runs entirely in your browser.</p>
        {#if !$settings.apiKey}
          <p class="warn">
            No API key set.
            <button onclick={() => (showSettings = true)}>Open Settings</button>
            to add your key.
          </p>
        {:else}
          <button class="btn-start" onclick={() => createConversation()}>
            Start a conversation
          </button>
        {/if}
      </div>
    {:else}
      <!-- Chat thread -->
      <div class="messages">
        <div class="messages-inner">
          {#if $activeConversation}
            <div class="thread-header">
              <span class="thread-badge">{$activeConversation.model}</span>
            </div>
          {/if}

          <!-- Persisted messages -->
          {#each $activeMessages as msg ((msg as any).timestamp)}
            <ChatMessage message={msg} isStreaming={false} />
          {/each}

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

      <ChatInput onSend={handleSend} onAbort={abortStreaming} />

      {#if $compactionStatus === 'compacting'}
        <div class="compaction-banner">
          <span class="compaction-spinner"></span>
          Compressing conversation history…
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

  .thread-header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 0 16px;
    flex-wrap: wrap;
  }

  .thread-badge {
    font-size: 0.75rem;
    color: var(--text-muted);
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 100px;
    padding: 3px 10px;
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

    /* Top bar replaces the sidebar brand on mobile */
    .mobile-header {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 52px;
      padding: 0 12px;
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
