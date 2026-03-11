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
    activeConversationId,
    activeConversation,
    isStreaming,
    streamError,
  } from '$lib/stores/chat';
  import { settings } from '$lib/stores/settings';

  let showSettings = $state(false);
  let chatEndEl = $state<HTMLDivElement | undefined>(undefined);

  onMount(async () => {
    await loadConversations();
  });

  // Auto-scroll to bottom when messages change or streaming
  $effect(() => {
    const _ = $activeMessages.length + ($isStreaming ? 1 : 0);
    void _;
    if (chatEndEl) {
      chatEndEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  });

  async function handleSend(content: string) {
    let convId = $activeConversationId;
    if (!convId) {
      convId = await createConversation($settings.model);
    }
    await sendMessage({
      content,
      conversationId: convId,
      model: $settings.model,
      apiKey: $settings.apiKey,
      systemPrompt: $settings.systemPrompt,
    });
  }

  // Apply theme
  $effect(() => {
    const theme = $settings.theme;
    const root = document.documentElement;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
  });
</script>

<svelte:head>
  <title>ThinClaw</title>
</svelte:head>

<div class="app-shell">
  <Sidebar onOpenSettings={() => (showSettings = true)} />

  <main class="chat-area">
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
            to add your OpenAI key.
          </p>
        {:else}
          <button class="btn-start" onclick={() => createConversation($settings.model)}>
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
              <span class="thread-model">{$activeConversation.model}</span>
            </div>
          {/if}

          {#each $activeMessages as msg, i (msg.id)}
            <ChatMessage
              message={msg}
              isStreaming={$isStreaming && i === $activeMessages.length - 1}
            />
          {/each}

          {#if $streamError}
            <div class="error-banner">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {$streamError}
            </div>
          {/if}

          <div bind:this={chatEndEl}></div>
        </div>
      </div>

      <ChatInput onSend={handleSend} />
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

  /* Welcome screen */
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

  .welcome p {
    color: var(--text-secondary);
    margin: 0;
    font-size: 1rem;
  }

  .warn {
    background: var(--warn-bg);
    color: var(--warn-color);
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

  /* Messages thread */
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
    padding: 8px 0 16px;
  }

  .thread-model {
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
</style>
