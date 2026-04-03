<script lang="ts">
  import { Plus, Star, Trash2 } from 'lucide-svelte'
  import {
    createConversation,
    removeConversation,
    selectConversation,
    starConversation,
    conversations,
    activeConversationId,
    isStreaming,
  } from '$lib/stores/chat'
  import { getPersonaById } from '$lib/agent/personas'
  import type { Conversation } from '$lib/db'

  interface Props {
    open?: boolean
    onClose?: () => void
    onScrollToBottom?: () => void
  }
  let { open = false, onClose, onScrollToBottom }: Props = $props()

  async function handleNew() {
    await createConversation()
    onClose?.()
  }

  async function handleSelect(id: string) {
    if ($isStreaming) return
    if ($activeConversationId === id) {
      onScrollToBottom?.()
      onClose?.()
      return
    }
    await selectConversation(id)
    onClose?.()
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation()
    await removeConversation(id)
  }

  async function handleStar(e: MouseEvent, conv: Conversation) {
    e.stopPropagation()
    await starConversation(conv.id, !conv.starred)
  }

  // ── Time grouping ──────────────────────────────────────────────────────────
  interface Groups {
    today: Conversation[]
    yesterday: Conversation[]
    thisWeek: Conversation[]
  }

  const groups = $derived.by<Groups>(() => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayMs = todayStart.getTime()
    const yesterdayMs = todayMs - 86_400_000
    const sevenDaysAgoMs = Date.now() - 7 * 86_400_000

    const today: Conversation[] = []
    const yesterday: Conversation[] = []
    const thisWeek: Conversation[] = []

    for (const conv of $conversations) {
      if (conv.updatedAt >= todayMs) {
        today.push(conv)
      } else if (conv.updatedAt >= yesterdayMs) {
        yesterday.push(conv)
      } else if (conv.updatedAt >= sevenDaysAgoMs) {
        thisWeek.push(conv)
      }
      // Older items already swept at startup — simply not rendered
    }

    return { today, yesterday, thisWeek }
  })

  const hasAny = $derived(
    groups.today.length + groups.yesterday.length + groups.thisWeek.length > 0,
  )
</script>

<aside
  class="sidebar flex flex-col h-full bg-surface-sidebar border-r border-line overflow-hidden
         w-[260px] min-w-[260px]"
  class:mobile-open={open}
>
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
    <span class="text-base font-bold tracking-tight text-fg">ThinClaw</span>
    <button
      class="flex items-center justify-center w-8 h-8 rounded-lg border border-line
             bg-transparent cursor-pointer text-fg-sub
             hover:bg-surface-hover hover:text-fg transition-colors duration-100"
      onclick={handleNew}
      title="新建对话 (⌘T)"
    >
      <Plus size={16} />
    </button>
  </div>

  <!-- List -->
  <nav class="flex-1 overflow-y-auto p-2">
    {#if !hasAny}
      <p class="text-center text-fg-muted text-[0.8rem] px-4 py-6 leading-relaxed">
        暂无对话。<br />点击 + 开始。
      </p>
    {/if}

    {#each ([['today', '今天'], ['yesterday', '昨天'], ['thisWeek', '一周内']] as const) as [key, label]}
      {@const list = groups[key]}
      {#if list.length > 0}
        <!-- Group label -->
        <div
          class="px-2.5 pt-3 pb-1 text-[0.7rem] font-semibold uppercase tracking-wider text-fg-muted select-none"
        >
          {label}
        </div>

        {#each list as conv (conv.id)}
          {@const isActive = $activeConversationId === conv.id}
          <div
            class="group/item flex items-center justify-between gap-1 px-2.5 py-2
                   rounded-lg cursor-pointer text-sm text-fg-sub min-h-9
                   transition-colors duration-100 hover:bg-surface-hover hover:text-fg"
            class:is-active={isActive}
            onclick={() => handleSelect(conv.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && handleSelect(conv.id)}
          >
            <!-- Star button: always in front of title -->
            <button
              class="flex items-center justify-center w-5 h-5 rounded bg-transparent
                     border-none cursor-pointer shrink-0 transition-colors duration-100
                     {conv.starred
                ? 'text-accent'
                : 'text-transparent group-hover/item:text-fg-muted hover:!text-accent'}"
              onclick={(e) => handleStar(e, conv)}
              title={conv.starred ? '取消收藏' : '收藏'}
            >
              <Star
                size={12}
                fill={conv.starred ? 'currentColor' : 'none'}
                stroke-width={conv.starred ? 0 : 1.8}
              />
            </button>

            <div class="flex-1 flex flex-col gap-0.5 overflow-hidden min-w-0">
              <span class="truncate">{conv.title}</span>
              {#if conv.personaId}
                {@const persona = getPersonaById(conv.personaId)}
                {#if persona}
                  <span
                    class="text-[0.72rem] text-fg-muted truncate
                           group-[.is-active]/item:text-accent group-[.is-active]/item:opacity-80"
                    >{persona.name}</span
                  >
                {/if}
              {/if}
            </div>

            <!-- Actions: visible on hover OR when active -->
            <div
              class="hidden group-hover/item:flex group-[.is-active]/item:flex
                     items-center gap-0.5 shrink-0"
            >
              <button
                class="flex items-center justify-center w-5 h-5 rounded bg-transparent
                       border-none cursor-pointer text-fg-muted
                       hover:bg-error-bg hover:text-error transition-colors duration-100"
                onclick={(e) => handleDelete(e, conv.id)}
                title="删除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        {/each}
      {/if}
    {/each}
  </nav>
</aside>

<style>
  /* Active conversation item */
  .is-active {
    background: var(--surface-active);
    color: var(--text-primary);
  }

  /* Mobile slide-in drawer */
  @media (max-width: 639px) {
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      height: 100%;
      z-index: 50;
      width: 280px;
      min-width: unset;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
    }
    .sidebar.mobile-open {
      transform: translateX(0);
    }
  }
</style>
