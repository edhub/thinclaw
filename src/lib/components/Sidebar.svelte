<script lang="ts">
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
    open?: boolean // mobile: whether the drawer is visible
    onClose?: () => void // mobile: called when sidebar should close
  }
  let { open = false, onClose }: Props = $props()

  let renamingId = $state<string | null>(null)
  let renameValue = $state('')

  async function handleNew() {
    await createConversation()
    onClose?.()
  }

  async function handleSelect(id: string) {
    onClose?.() // always close drawer on mobile
    if ($activeConversationId === id) return
    // Don't allow switching while the agent is mid-stream: the agent's internal
    // message list and _prevMessageCounts would get entangled between conversations.
    if ($isStreaming) return
    await selectConversation(id)
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation()
    await removeConversation(id)
  }

  function startRename(e: MouseEvent, id: string, currentTitle: string) {
    e.stopPropagation()
    renamingId = id
    renameValue = currentTitle
  }

  async function commitRename(id: string) {
    if (renameValue.trim()) await renameConversation(id, renameValue.trim())
    renamingId = null
  }
</script>

<aside class="sidebar" class:mobile-open={open}>
  <div class="sidebar-header">
    <span class="brand">ThinClaw</span>
    <button class="btn-icon" onclick={handleNew} title="新建对话">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  </div>

  <nav class="conv-list">
    {#each $conversations as conv (conv.id)}
      <div
        class="conv-item"
        class:active={$activeConversationId === conv.id}
        onclick={() => handleSelect(conv.id)}
        role="button"
        tabindex="0"
        onkeydown={(e) => e.key === 'Enter' && handleSelect(conv.id)}
      >
        {#if renamingId === conv.id}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="rename-input"
            bind:value={renameValue}
            onblur={() => commitRename(conv.id)}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename(conv.id)
              if (e.key === 'Escape') {
                renamingId = null
              }
            }}
            onclick={(e) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <div class="conv-body">
            <span class="conv-title">{conv.title}</span>
            {#if conv.personaId}
              {@const persona = getPersonaById(conv.personaId)}
              {#if persona}
                <span class="conv-persona">{persona.name}</span>
              {/if}
            {/if}
          </div>
          <div class="conv-actions">
            <button
              class="btn-icon-sm"
              onclick={(e) => startRename(e, conv.id, conv.title)}
              title="重命名"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
            <button
              class="btn-icon-sm danger"
              onclick={(e) => handleDelete(e, conv.id)}
              title="删除"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6M9 6V4h6v2" />
              </svg>
            </button>
          </div>
        {/if}
      </div>
    {/each}

    {#if $conversations.length === 0}
      <p class="empty-hint">暂无对话。<br />点击 + 开始。</p>
    {/if}
  </nav>

</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    width: 260px;
    min-width: 260px;
    height: 100%;
    background: var(--surface-sidebar);
    border-right: 1px solid var(--border);
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .brand {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }

  .conv-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }

  .conv-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text-secondary);
    transition: background 0.1s;
    min-height: 36px;
  }

  .conv-item:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .conv-item.active {
    background: var(--surface-active);
    color: var(--text-primary);
  }

  .conv-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .conv-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conv-persona {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .conv-item.active .conv-persona {
    color: var(--accent);
    opacity: 0.8;
  }

  .conv-actions {
    display: none;
    gap: 2px;
    flex-shrink: 0;
  }

  .conv-item:hover .conv-actions,
  .conv-item.active .conv-actions {
    display: flex;
  }

  .rename-input {
    flex: 1;
    background: var(--surface-input);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 0.875rem;
    color: var(--text-primary);
    outline: none;
  }

  .empty-hint {
    text-align: center;
    color: var(--text-muted);
    font-size: 0.8rem;
    padding: 24px 16px;
    line-height: 1.6;
  }

  .btn-icon {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px;
    cursor: pointer;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    transition: all 0.1s;
  }

  .btn-icon:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .btn-icon-sm {
    background: none;
    border: none;
    border-radius: 4px;
    padding: 3px;
    cursor: pointer;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    transition: all 0.1s;
  }

  .btn-icon-sm:hover {
    background: var(--surface-hover);
    color: var(--text-secondary);
  }

  .btn-icon-sm.danger:hover {
    color: var(--error);
    background: var(--error-bg);
  }

  /* ── Mobile: slide-in drawer ── */
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
      /* shadow to separate from backdrop */
      box-shadow: 4px 0 24px rgba(0, 0, 0, 0.18);
    }

    .sidebar.mobile-open {
      transform: translateX(0);
    }
  }
</style>
