<script lang="ts">
  import { Plus, Pencil, Trash2 } from 'lucide-svelte'
  import {
    createConversation,
    removeConversation,
    selectConversation,
    renameConversation,
    conversations,
    activeConversationId,
    isStreaming,
  } from '$lib/stores/chat'
  import { getPersonaById } from '$lib/agent/personas'

  interface Props {
    open?: boolean
    onClose?: () => void
  }
  let { open = false, onClose }: Props = $props()

  let renamingId = $state<string | null>(null)
  let renameValue = $state('')

  async function handleNew() {
    await createConversation()
    onClose?.()
  }

  async function handleSelect(id: string) {
    if ($activeConversationId === id || $isStreaming) return
    await selectConversation(id)
    onClose?.()
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation()
    await removeConversation(id)
  }

  function startRename(e: MouseEvent, id: string, title: string) {
    e.stopPropagation()
    renamingId = id
    renameValue = title
  }

  async function commitRename(id: string) {
    if (renameValue.trim()) await renameConversation(id, renameValue.trim())
    renamingId = null
  }
</script>

<aside
  class="sidebar flex flex-col h-full bg-surface-sidebar border-r border-line overflow-hidden
         w-[260px] min-w-[260px]"
  class:mobile-open={open}
>
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-line flex-shrink-0">
    <span class="text-base font-bold tracking-tight text-fg">ThinClaw</span>
    <button
      class="flex items-center justify-center w-8 h-8 rounded-lg border border-line
             bg-transparent cursor-pointer text-fg-sub
             hover:bg-surface-hover hover:text-fg transition-colors duration-100"
      onclick={handleNew}
      title="新建对话"
    >
      <Plus size={16} />
    </button>
  </div>

  <!-- List -->
  <nav class="flex-1 overflow-y-auto p-2">
    {#each $conversations as conv (conv.id)}
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
        {#if renamingId === conv.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="flex-1 bg-surface-input border border-accent rounded px-1.5 py-0.5
                   text-sm text-fg outline-none"
            bind:value={renameValue}
            onblur={() => commitRename(conv.id)}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename(conv.id)
              if (e.key === 'Escape') renamingId = null
            }}
            onclick={(e) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <div class="flex-1 flex flex-col gap-0.5 overflow-hidden">
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
                   items-center gap-0.5 flex-shrink-0"
          >
            <button
              class="flex items-center justify-center w-5 h-5 rounded bg-transparent
                     border-none cursor-pointer text-fg-muted
                     hover:bg-surface-hover hover:text-fg-sub transition-colors duration-100"
              onclick={(e) => startRename(e, conv.id, conv.title)}
              title="重命名"
            >
              <Pencil size={12} />
            </button>
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
        {/if}
      </div>
    {/each}

    {#if $conversations.length === 0}
      <p class="text-center text-fg-muted text-[0.8rem] px-4 py-6 leading-relaxed">
        暂无对话。<br />点击 + 开始。
      </p>
    {/if}
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
