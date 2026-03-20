<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import {
    Settings,
    Printer,
    FolderOpen,
    Menu,
    Plus,
    Bot,
    AlertCircle,
    X,
    RotateCcw,
  } from 'lucide-svelte'
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

  const msgKeys = new WeakMap<AgentMessage, string>()
  function keyOf(msg: AgentMessage): string {
    let k = msgKeys.get(msg)
    if (!k) {
      k = nanoid()
      msgKeys.set(msg, k)
    }
    return k
  }

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

  function isErrorMsg(msg: AgentMessage): boolean {
    const m = msg as any
    return m.role === 'assistant' && (m.stopReason === 'error' || !!m.errorMessage)
  }

  let sidebarOpen = $state(false)
  let chatEndEl = $state<HTMLDivElement | undefined>(undefined)
  let chatInputRef = $state<{ focus: () => void } | undefined>(undefined)
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
    sweepSessions().catch(() => {})
    await memories.load()
    await loadConversations()
    const list = get(conversations)
    if (list.length > 0) await selectConversation(list[0].id)
  })

  onDestroy(() => document.removeEventListener('keydown', handleGlobalKeydown))

  $effect(() => {
    const _convId = $activeConversationId
    void _convId
    requestAnimationFrame(() => {
      chatEndEl?.scrollIntoView({ behavior: 'instant', block: 'end' })
    })
  })

  $effect(() => {
    if (chatInputOpen) {
      tick().then(() => chatInputRef?.focus())
    }
  })

  async function handleSend(content: string, images: ImageContent[]) {
    chatInputOpen = false
    await sendMessage(content, images)
  }
</script>

<svelte:head>
  <title>ThinClaw</title>
</svelte:head>

<div class="app-shell flex h-screen overflow-hidden bg-surface">
  <!-- Mobile backdrop -->
  {#if sidebarOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="mobile-backdrop fixed inset-0 bg-black/40 z-40 hidden"
      role="presentation"
      onclick={() => (sidebarOpen = false)}
    ></div>
  {/if}

  <Sidebar open={sidebarOpen} onClose={() => (sidebarOpen = false)} />

  <main class="flex-1 flex flex-col overflow-hidden min-w-0 relative">
    <!-- Mobile top bar -->
    <header
      class="mobile-header hidden items-center gap-1.5 h-[52px] px-2 pl-3
                   border-b border-line bg-surface flex-shrink-0"
    >
      <button
        class="bg-transparent border-none p-1.5 rounded-lg cursor-pointer text-fg-sub flex
               items-center flex-shrink-0 transition-all duration-100 hover:bg-surface-hover hover:text-fg"
        onclick={() => (sidebarOpen = true)}
        aria-label="打开侧边栏"
      >
        <Menu size={18} />
      </button>
      <span
        class="flex-1 text-[0.9rem] font-semibold text-fg overflow-hidden text-ellipsis
                   whitespace-nowrap text-center"
      >
        {$activeConversation?.title ?? 'ThinClaw'}
      </span>
      <ModelSwitcher />
      <div class="flex items-center flex-shrink-0">
        {#if $activeConversationId && $settings.laozhangApiKey}
          <button
            class="bg-transparent border-none p-1.5 rounded-lg cursor-pointer text-[0.95rem]
                   leading-none transition-all duration-100 opacity-40 hover:bg-surface-hover
                   hover:opacity-80"
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
            class="bg-transparent border-none p-1.5 rounded-lg cursor-pointer text-fg-sub flex
                   items-center flex-shrink-0 transition-all duration-100 hover:bg-surface-hover hover:text-fg"
            onclick={() => window.print()}
            aria-label="打印 / 保存为 PDF"
            title="打印 / 保存为 PDF"
          >
            <Printer size={15} />
          </button>
        {/if}
        <a
          href="/files"
          class="bg-transparent border-none p-1.5 rounded-lg cursor-pointer text-fg-sub flex
                  items-center flex-shrink-0 transition-all duration-100 hover:bg-surface-hover
                  hover:text-fg no-underline"
          aria-label="文件浏览器"
          title="文件浏览器"
          target="_blank"
          rel="noopener noreferrer"
        >
          <FolderOpen size={15} />
        </a>
        <a
          href="/settings"
          class="bg-transparent border-none p-1.5 rounded-lg cursor-pointer text-fg-sub flex
                  items-center flex-shrink-0 transition-all duration-100 hover:bg-surface-hover
                  hover:text-fg no-underline"
          aria-label="设置"
        >
          <Settings size={16} />
        </a>
      </div>
    </header>

    <!-- Desktop floating controls (top-right) -->
    <div class="chat-controls absolute top-2.5 right-3.5 flex items-center flex-col gap-0.5 z-10">
      <div class="flex flex-col gap-0.5">
        <a
          href="/settings"
          class="bg-transparent border-none p-1.5 rounded-lg cursor-pointer text-fg-sub flex
                  items-center no-underline transition-all duration-100
                  hover:bg-surface-hover hover:text-fg"
          aria-label="设置"
          title="设置"
        >
          <Settings size={16} />
        </a>
        <a
          href="/files"
          class="bg-transparent border-none p-1.5 rounded-lg cursor-pointer text-fg-sub flex
                  items-center no-underline transition-all duration-100
                  hover:bg-surface-hover hover:text-fg"
          aria-label="文件浏览器"
          title="文件浏览器"
          target="_blank"
          rel="noopener noreferrer"
        >
          <FolderOpen size={15} />
        </a>
        {#if $activeConversationId}
          <button
            class="bg-transparent border-none p-1.5 rounded-lg cursor-pointer text-fg-sub flex
                   items-center transition-all duration-100 hover:bg-surface-hover hover:text-fg"
            onclick={() => window.print()}
            aria-label="打印 / 保存为 PDF"
            title="打印 / 保存为 PDF"
          >
            <Printer size={15} />
          </button>
        {/if}
      </div>
      <ModelSwitcher />
      {#if $activeConversationId && $settings.laozhangApiKey}
        <button
          class="bg-transparent border-none p-1 px-1.5 rounded-lg cursor-pointer text-[0.95rem]
                 leading-none transition-all duration-100 opacity-40 hover:bg-surface-hover hover:opacity-80
                 flex-shrink-0"
          class:tool-active={$imageToolEnabled}
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
      <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-fg">
        <div class="text-5xl">🦀</div>
        <h1 class="text-[1.75rem] font-bold m-0 tracking-tight">ThinClaw</h1>
        <p class="text-fg-sub m-0 text-base">一款完全在浏览器中运行的轻量级 AI 聊天应用。</p>
        {#if !$settings.laozhangApiKey}
          <p
            class="flex items-center gap-1.5 bg-warn-bg text-warn px-4 py-2.5 rounded-lg
                    text-[0.9rem] m-0"
          >
            未设置 API 密钥。
            <a href="/settings" class="text-accent text-[0.9rem] underline">打开设置</a>
            以添加您的密钥。
          </p>
        {:else}
          <button
            class="bg-accent text-white border-none rounded-xl px-6 py-2.5 text-[0.95rem]
                   font-medium cursor-pointer mt-2 transition-opacity duration-100 hover:opacity-85"
            onclick={() => createConversation()}
          >
            开始对话
          </button>
        {/if}
      </div>
    {:else}
      <!-- Chat thread -->
      <div class="flex-1 overflow-y-auto overflow-x-hidden px-6 messages-scroll">
        <div class="max-w-[860px] mx-auto py-6 pb-[120px]">
          <!-- Persona picker + new message actions -->
          {#if $activeMessages.length === 0 && !$isStreaming && !$pendingUserMessage}
            <PersonaPicker />
            <div class="flex items-center justify-center gap-3 mt-4">
              <button
                class="inline-flex items-center gap-1.5 bg-transparent border border-line
                       rounded-lg px-3.5 py-1.5 text-[0.82rem] text-fg-sub cursor-pointer
                       transition-all duration-150 hover:border-accent hover:text-accent
                       hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]"
                onclick={() => (chatInputOpen = true)}
              >
                <Plus size={13} />
                新消息
              </button>
              <span class="text-[0.72rem] text-fg-muted opacity-60">
                或按 <kbd
                  class="inline-block bg-surface-elevated border border-line rounded
                              px-1.5 py-px text-[0.7rem] font-[inherit] text-fg-muted"
                  >{shortcutHint}</kbd
                >
              </span>
            </div>
          {/if}

          <!-- Persisted messages -->
          {#each $activeMessages.filter((m) => (m as any).role !== 'compactionSummary') as msg, i (keyOf(msg))}
            <ChatMessage
              message={msg}
              isStreaming={false}
              {toolResultMap}
              onDelete={isErrorMsg(msg) ? () => deleteErrorMessage(msg) : undefined}
              onRetry={isErrorMsg(msg) ? () => retryFromError(msg) : undefined}
            />
          {/each}

          <!-- Optimistic user message -->
          {#if $pendingUserMessage}
            <ChatMessage message={$pendingUserMessage} isStreaming={false} {toolResultMap} />
          {/if}

          <!-- Loading placeholder -->
          {#if $isStreaming && !$streamingMessage}
            <div class="flex items-center gap-3 py-3.5">
              <div
                class="w-7 h-7 rounded-full bg-surface-elevated text-fg-sub border border-line
                          flex items-center justify-center flex-shrink-0"
              >
                <Bot size={14} />
              </div>
              <div class="flex items-center gap-1.5 pt-0.5">
                <span class="ai-dot animate-dot-bounce [animation-delay:0s]"></span>
                <span class="ai-dot animate-dot-bounce [animation-delay:200ms]"></span>
                <span class="ai-dot animate-dot-bounce [animation-delay:400ms]"></span>
              </div>
            </div>
          {/if}

          <!-- Streaming message -->
          {#if $streamingMessage}
            <ChatMessage message={$streamingMessage} isStreaming={true} {toolResultMap} />
          {/if}

          {#if $streamError}
            <div
              class="flex items-center gap-2 bg-error-bg text-error border border-error
                        rounded-lg px-3.5 py-2 text-sm my-2"
            >
              <AlertCircle size={14} class="flex-shrink-0" />
              <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {$streamError}
              </span>
              <button
                class="bg-transparent border-none cursor-pointer px-2 py-1 rounded-[5px] text-[0.78rem]
                       text-error opacity-80 whitespace-nowrap flex-shrink-0 flex items-center gap-1
                       transition-all duration-100 hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)]
                       hover:opacity-100"
                onclick={() => retryLastMessage()}
                title="重新发送上次消息"
              >
                <RotateCcw size={12} /> 重试
              </button>
              <button
                class="bg-transparent border-none cursor-pointer px-2 py-1 rounded-[5px] text-[0.85rem]
                       text-error opacity-50 flex-shrink-0 flex items-center
                       transition-all duration-100 hover:bg-[color-mix(in_srgb,var(--error)_15%,transparent)]
                       hover:opacity-100"
                onclick={() => streamError.set(null)}
                title="关闭"
              >
                <X size={14} />
              </button>
            </div>
          {/if}

          <div bind:this={chatEndEl}></div>
        </div>
      </div>

      {#if $compactionStatus === 'compacting'}
        <div
          class="flex items-center justify-center gap-2 px-4 py-2 text-[0.8rem] text-fg-muted
                    border-t border-line bg-surface"
        >
          <span
            class="inline-block w-3 h-3 border-2 border-line border-t-accent
                       rounded-full animate-spin flex-shrink-0"
          ></span>
          正在压缩对话历史…
        </div>
      {/if}
    {/if}
  </main>

  <!-- Chat input modal -->
  {#if chatInputOpen}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="fixed inset-0 bg-black/40 z-[60] animate-modal-fade-in"
      role="presentation"
      onclick={() => (chatInputOpen = false)}
    ></div>
    <div
      class="fixed top-[10vh] left-1/2 -translate-x-1/2 z-[70] w-[min(92vw,760px)]
                bg-surface border border-line rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.2)]
                max-h-[70vh] overflow-y-auto animate-modal-slide-up"
    >
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

  <!-- Floating action button -->
  {#if !chatInputOpen}
    <button
      class="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-accent border-none text-white
             flex items-center justify-center cursor-pointer z-50
             shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-all duration-200
             hover:scale-110 hover:shadow-[0_6px_16px_rgba(0,0,0,0.2)]
             active:scale-95"
      onclick={() => (chatInputOpen = true)}
      aria-label="打开聊天输入"
      title="打开聊天输入"
    >
      <Plus size={22} />
    </button>
  {/if}
</div>

<style>
  /* Mobile: show backdrop + header, hide desktop controls */
  @media (max-width: 639px) {
    .mobile-backdrop {
      display: block !important;
    }
    .mobile-header {
      display: flex !important;
    }
    .chat-controls {
      display: none !important;
    }
    .messages-scroll {
      padding-left: 12px;
      padding-right: 12px;
    }
    .messages-scroll > div {
      padding-top: 16px;
      padding-bottom: 100px;
    }
  }

  /* Image-tool active state */
  .tool-active {
    background: var(--surface-active);
    opacity: 1 !important;
  }

  /* AI dot — shape only; animation applied via Tailwind animate-dot-bounce */
  .ai-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-muted);
  }
</style>
