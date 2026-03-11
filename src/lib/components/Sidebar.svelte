<script lang="ts">
  import { createConversation, removeConversation, selectConversation, renameConversation, conversations, activeConversationId } from '$lib/stores/chat';

  interface Props {
    onOpenSettings: () => void;
  }
  let { onOpenSettings }: Props = $props();

  let renamingId = $state<string | null>(null);
  let renameValue = $state('');

  async function handleNew() {
    await createConversation();
  }

  async function handleSelect(id: string) {
    if ($activeConversationId === id) return;
    await selectConversation(id);
  }

  async function handleDelete(e: MouseEvent, id: string) {
    e.stopPropagation();
    await removeConversation(id);
  }

  function startRename(e: MouseEvent, id: string, currentTitle: string) {
    e.stopPropagation();
    renamingId = id;
    renameValue = currentTitle;
  }

  async function commitRename(id: string) {
    if (renameValue.trim()) await renameConversation(id, renameValue.trim());
    renamingId = null;
  }
</script>

<aside class="sidebar">
  <div class="sidebar-header">
    <span class="brand">ThinClaw</span>
    <button class="btn-icon" onclick={handleNew} title="New conversation">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14"/>
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
              if (e.key === 'Enter') commitRename(conv.id);
              if (e.key === 'Escape') { renamingId = null; }
            }}
            onclick={(e) => e.stopPropagation()}
            autofocus
          />
        {:else}
          <span class="conv-title">{conv.title}</span>
          <div class="conv-actions">
            <button class="btn-icon-sm" onclick={(e) => startRename(e, conv.id, conv.title)} title="Rename">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-icon-sm danger" onclick={(e) => handleDelete(e, conv.id)} title="Delete">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
              </svg>
            </button>
          </div>
        {/if}
      </div>
    {/each}

    {#if $conversations.length === 0}
      <p class="empty-hint">No conversations yet.<br/>Click + to start.</p>
    {/if}
  </nav>

  <div class="sidebar-footer">
    <button class="btn-settings" onclick={onOpenSettings}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
      Settings
    </button>
  </div>
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

  .conv-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .sidebar-footer {
    padding: 12px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
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

  .btn-settings {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.875rem;
    color: var(--text-secondary);
    transition: all 0.1s;
  }

  .btn-settings:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
</style>
