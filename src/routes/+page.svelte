<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import Sidebar from '$lib/components/Sidebar.svelte'
  import ChatMessage from '$lib/components/ChatMessage.svelte'
  import ChatInput from '$lib/components/ChatInput.svelte'
  import ModelSwitcher from '$lib/components/ModelSwitcher.svelte'
  import PersonaPicker from '$lib/components/PersonaPicker.svelte'
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
    imageToolEnabled,
    toggleImageTool,
    deleteErrorMessage,
    retryFromError,
    retryLastMessage,
  } from '$lib/stores/chat'
  import { get } from 'svelte/store'
  import { nanoid } from '$lib/utils/nanoid'
  import type { AgentMessage } from '@mariozechner/pi-agent-core'

  // Assign a stable random key to each message object on first encounter.
  // Using WeakMap avoids memory leaks — keys are GC'd with their message objects.
  const msgKeys = new WeakMap<AgentMessage, string>()
  function keyOf(msg: AgentMessage): string {
    let k = msgKeys.get(msg)
    if (!k) {
      k = nanoid()
      msgKeys.set(msg, k)
    }
    return k
  }

  // Build toolCallId → ToolResultMessage map so ChatMessage can pair calls with results.
  const toolResultMap = $derived(
    new Map(
      ($activeMessages as AgentMessage[])
        .filter((m): m is ToolResultMessage => m.role === 'toolResult')
        .map((m) => [m.toolCallId, m]),
    ),
  )
  import type { ImageContent, ToolResultMessage } from '@mariozechner/pi-ai'
  import { memories } from '$lib/stores/memory'
  import { settings } from '$lib/stores/settings'
  import { sweepSessions } from '$lib/fs/session-recorder'

  /** True if a message is an error assistant message (shows the collapsible error card). */
  function isErrorMsg(msg: AgentMessage): boolean {
    const m = msg as any
    return m.role === 'assistant' && (m.stopReason === 'error' || !!m.errorMessage)
  }

  let sidebarOpen = $state(false)
  let chatEndEl = $state<HTMLDivElement | undefined>(undefined)
  let chatInputRef = $state<{ focus: () => void } | undefined>(undefined)
  // Chat input is closed by default; user opens it via FAB or ⌘K.
  let chatInputOpen = $state(false)

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform)
  const shortcutHint = isMac ? '⌘K' : 'Ctrl+K'

  function handleGlobalKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      if (!$activeConversationId) {
        createConversation()
        tick().then(() => (chatInputOpen = true))
      } else {
        chatInputOpen = true
      }
    }
  }

  onMount(async () => {
    document.addEventListener('keydown', handleGlobalKeydown)

    // Sweep expired session files once per browser session (non-blocking).
    sweepSessions().catch(() => {})
    // Load memories once at startup. The memory_save / memory_delete tools
    // keep the store in sync incrementally — no need to reload on every agent turn.
    await memories.load()
    await loadConversations()
    // Auto-open the most recent conversation on startup.
    const list = get(conversations)
    if (list.length > 0) await selectConversation(list[0].id)
  })

  onDestroy(() => document.removeEventListener('keydown', handleGlobalKeydown))

  // Scroll to bottom on conversation switch — use rAF so the browser has time
  // to finish layout before we call scrollIntoView (messages are bulk-inserted).
  $effect(() => {
    const _convId = $activeConversationId
    void _convId
    requestAnimationFrame(() => {
      chatEndEl?.scrollIntoView({ behavior: 'instant', block: 'end' })
    })
  })

  // Focus input when modal opens
  $effect(() => {
    if (chatInputOpen) {
      tick().then(() => chatInputRef?.focus())
    }
  })

  async function handleSend(content: string, images: ImageContent[]) {
    chatInputOpen = false
    await sendMessage(content, images)
  }

  // Apply theme
  $effect(() => {
    const theme = $settings.theme
    const root = document.documentElement
    if (theme === 'dark') root.setAttribute('data-theme', 'dark')
    else if (theme === 'light') root.setAttribute('data-theme', 'light')
    else root.removeAttribute('data-theme')
  })
</script>

{#snippet gearIcon()}
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
  >
    <circle cx="12" cy="12" r="3" />
    <path
      d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
    />
  </svg>
{/snippet}

{#snippet printIcon()}
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
{/snippet}

<svelte:head>
  <title>ThinClaw</title>
</svelte:head>

<div class="app-shell">
  <!-- Mobile backdrop (shown when sidebar is open) -->
  {#if sidebarOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="mobile-backdrop" role="presentation" onclick={() => (sidebarOpen = false)}></div>
  {/if}

  <Sidebar
    open={sidebarOpen}
    onClose={() => (sidebarOpen = false)}
  />

  <main class="chat-area">
    <!-- Mobile-only top bar -->
    <header class="mobile-header">
      <button class="btn-hamburger" onclick={() => (sidebarOpen = true)} aria-label="打开侧边栏">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>
      <span class="mobile-title">
        {$activeConversation?.title ?? 'ThinClaw'}
      </span>
      <ModelSwitcher />
      <div class="mobile-header-actions">
        {#if $activeConversationId && $settings.laozhangApiKey}
          <button
            class="btn-tool-toggle"
            class:active={$imageToolEnabled}
            onclick={toggleImageTool}
            aria-label={$imageToolEnabled ? '停用图像生成工具' : '启用图像生成工具'}
            title={$imageToolEnabled ? '图像工具已启用（点击关闭）' : '启用图像生成工具'}
          >
            🎨
          </button>
        {/if}
        {#if $activeConversationId}
          <button
            class="btn-mobile-settings"
            onclick={() => window.print()}
            aria-label="打印 / 保存为 PDF"
            title="打印 / 保存为 PDF"
          >
            {@render printIcon()}
          </button>
        {/if}
        <a href="/files" class="btn-mobile-settings" aria-label="文件浏览器" title="文件浏览器" target="_blank" rel="noopener noreferrer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </a>
        <a href="/settings" class="btn-mobile-settings" aria-label="设置">
          {@render gearIcon()}
        </a>
      </div>
    </header>

    <!-- Desktop: floating controls in top-right corner -->
    <div class="chat-controls">
      <div class="btn-icon-group">
        <a href="/settings" class="btn-settings" aria-label="设置" title="设置">
          {@render gearIcon()}
        </a>
        <a href="/files" class="btn-settings" aria-label="文件浏览器" title="文件浏览器" target="_blank" rel="noopener noreferrer">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </a>
        {#if $activeConversationId}
          <button
            class="btn-settings"
            onclick={() => window.print()}
            aria-label="打印 / 保存为 PDF"
            title="打印 / 保存为 PDF"
          >
            {@render printIcon()}
          </button>
        {/if}
      </div>
      <ModelSwitcher />
      {#if $activeConversationId && $settings.laozhangApiKey}
        <button
          class="btn-tool-toggle"
          class:active={$imageToolEnabled}
          onclick={toggleImageTool}
          aria-label={$imageToolEnabled ? '停用图像生成工具' : '启用图像生成工具'}
          title={$imageToolEnabled ? '图像工具已启用（点击关闭）' : '启用图像生成工具'}
        >
          🎨
        </button>
      {/if}
    </div>

    {#if !$activeConversationId}
      <!-- Welcome screen -->
      <div class="welcome">
        <div class="welcome-icon">🦀</div>
        <h1>ThinClaw</h1>
        <p>一款完全在浏览器中运行的轻量级 AI 聊天应用。</p>
        {#if !$settings.laozhangApiKey}
          <p class="warn">
            未设置 API 密钥。
            <a href="/settings">打开设置</a>
            以添加您的密钥。
          </p>
        {:else}
          <button class="btn-start" onclick={() => createConversation()}> 开始对话 </button>
        {/if}
      </div>
    {:else}
      <!-- Chat thread -->
      <div class="messages">
        <div class="messages-inner">
          <!-- Persona picker: shown only while the conversation has no messages -->
          {#if $activeMessages.length === 0 && !$isStreaming && !$pendingUserMessage}
            <PersonaPicker />
            <div class="empty-actions">
              <button class="btn-new-msg" onclick={() => (chatInputOpen = true)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                新消息
              </button>
              <span class="shortcut-hint">或按 <kbd>{shortcutHint}</kbd></span>
            </div>
          {/if}

          <!-- Persisted messages -->
          <!-- compactionSummary is an internal bookkeeping message; excluded from the visible chat UI. -->
          {#each $activeMessages.filter(m => (m as any).role !== 'compactionSummary') as msg, i (keyOf(msg))}
            <ChatMessage
              message={msg}
              isStreaming={false}
              {toolResultMap}
              onDelete={isErrorMsg(msg) ? () => deleteErrorMessage(msg) : undefined}
              onRetry={isErrorMsg(msg) ? () => retryFromError(msg) : undefined}
            />
          {/each}

          <!-- Optimistic user message shown immediately on send -->
          {#if $pendingUserMessage}
            <ChatMessage message={$pendingUserMessage} isStreaming={false} {toolResultMap} />
          {/if}

          <!-- Loading placeholder: request is in-flight but no streaming chunk yet -->
          {#if $isStreaming && !$streamingMessage}
            <div class="ai-loading">
              <div class="ai-loading-avatar">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path
                    d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"
                  />
                </svg>
              </div>
              <div class="ai-loading-dots">
                <span></span><span></span><span></span>
              </div>
            </div>
          {/if}

          <!-- In-flight streaming message -->
          {#if $streamingMessage}
            <ChatMessage message={$streamingMessage} isStreaming={true} {toolResultMap} />
          {/if}

          {#if $streamError}
            <div class="error-banner">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span class="error-banner-text">{$streamError}</span>
              <button class="error-banner-btn" onclick={() => retryLastMessage()} title="重新发送上次消息">
                ↺ 重试
              </button>
              <button class="error-banner-btn error-banner-dismiss" onclick={() => streamError.set(null)} title="关闭">
                ✕
              </button>
            </div>
          {/if}

          <div bind:this={chatEndEl}></div>
        </div>
      </div>

      {#if $compactionStatus === 'compacting'}
        <div class="compaction-banner">
          <span class="compaction-spinner"></span>
          正在压缩对话历史…
        </div>
      {/if}
    {/if}
  </main>

  <!-- Chat input modal backdrop + modal (combined to avoid duplicate condition) -->
  {#if chatInputOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div 
      class="chat-input-backdrop" 
      role="presentation" 
      onclick={() => (chatInputOpen = false)}
    ></div>
    <div class="chat-input-modal">
      <ChatInput 
        bind:this={chatInputRef} 
        onSend={handleSend} 
        onAbort={abortStreaming}
        open={true}
        onClose={() => (chatInputOpen = false)}
        isModal={true}
      />
    </div>
  {/if}

  <!-- Floating action button (when chat input is closed) -->
  {#if !chatInputOpen}
    <button 
      class="floating-input-btn"
      onclick={() => (chatInputOpen = true)}
      aria-label="打开聊天输入"
      title="打开聊天输入"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
  {/if}
</div>


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

  .welcome-icon {
    font-size: 3rem;
  }

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
    background: var(--warn-bg, var(--error-bg));
    color: var(--warn-color, var(--error));
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 0.9rem !important;
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .warn a {
    color: var(--accent);
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
  .btn-start:hover {
    opacity: 0.85;
  }

  /* Messages */
  .messages {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 24px;
  }

  .messages-inner {
    max-width: 860px;
    margin: 0 auto;
    padding: 24px 0 120px;
  }

  .shortcut-hint {
    font-size: 0.72rem;
    color: var(--text-muted);
    opacity: 0.6;
  }

  .shortcut-hint kbd {
    display: inline-block;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 0.7rem;
    font-family: inherit;
    color: var(--text-muted);
  }

  .empty-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 16px;
  }

  .btn-new-msg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 0.82rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn-new-msg:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--error-bg);
    color: var(--error);
    border: 1px solid var(--error);
    border-radius: 8px;
    padding: 8px 10px 8px 14px;
    font-size: 0.875rem;
    margin: 8px 0;
  }

  .error-banner-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error-banner-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 3px 8px;
    border-radius: 5px;
    font-size: 0.78rem;
    color: var(--error);
    opacity: 0.8;
    white-space: nowrap;
    flex-shrink: 0;
    transition: all 0.1s;
  }

  .error-banner-btn:hover {
    background: color-mix(in srgb, var(--error) 15%, transparent);
    opacity: 1;
  }

  .error-banner-dismiss {
    opacity: 0.5;
    font-size: 0.85rem;
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

  .ai-loading-dots span:nth-child(2) {
    animation-delay: 0.2s;
  }
  .ai-loading-dots span:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes ai-dot-bounce {
    0%,
    80%,
    100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    40% {
      transform: translateY(-5px);
      opacity: 1;
    }
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
    to {
      transform: rotate(360deg);
    }
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
    flex-direction: column;
    gap: 2px;
    z-index: 10;
  }

  .btn-icon-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
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
    text-decoration: none;
    transition: all 0.1s;
    flex-shrink: 0;
  }
  .btn-settings:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .btn-tool-toggle {
    background: none;
    border: none;
    padding: 4px 6px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.95rem;
    line-height: 1;
    transition: all 0.1s;
    opacity: 0.4;
    flex-shrink: 0;
  }
  .btn-tool-toggle:hover {
    background: var(--surface-hover);
    opacity: 0.8;
  }
  .btn-tool-toggle.active {
    background: var(--surface-active);
    opacity: 1;
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

    .mobile-header-actions {
      display: flex;
      align-items: center;
      gap: 0;
      flex-shrink: 0;
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
      text-decoration: none;
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
      padding: 16px 0 100px;
    }
  }

  /* ── Chat input modal ── */
  .chat-input-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 60;
    animation: fadeIn 0.2s ease-out;
  }

  .chat-input-modal {
    position: fixed;
    top: 10vh;
    left: 50%;
    transform: translateX(-50%);
    z-index: 70;
    width: min(92vw, 760px);
    background: var(--surface-main);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    animation: slideUp 0.3s ease-out;
    max-height: 70vh;
    overflow-y: auto;
  }

  /* Show the floating button */
  .floating-input-btn {
    display: flex;
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--accent);
    border: none;
    color: white;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 50;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    transition: all 0.2s ease;
  }

  .floating-input-btn:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
  }

  .floating-input-btn:active {
    transform: scale(0.95);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(30px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  /* ── Print / Save as PDF ── */
  @media print {
    /* Hide everything except the chat messages */
    :global(body) {
      background: white !important;
    }

    .mobile-backdrop,
    .mobile-header,
    .chat-controls,
    .floating-input-btn,
    .chat-input-backdrop,
    .chat-input-modal,
    .compaction-banner {
      display: none !important;
    }

    /* Hide sidebar — it lives outside .chat-area */
    :global(.sidebar) {
      display: none !important;
    }

    .app-shell {
      display: block;
      height: auto;
      overflow: visible;
    }

    .chat-area {
      display: block;
      overflow: visible;
    }

    .messages {
      overflow: visible;
      padding: 0 32px;
    }

    .messages-inner {
      max-width: 100%;
      padding: 16px 0 24px;
    }

    /* Remove the welcome screen if somehow triggered */
    .welcome {
      display: none !important;
    }
  }
</style>
