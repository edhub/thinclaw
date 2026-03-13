<script lang="ts">
  import { memories } from '$lib/stores/memory'
  import SettingsGeneral from './SettingsGeneral.svelte'
  import SettingsSoul from './SettingsSoul.svelte'
  import SettingsMemory from './SettingsMemory.svelte'

  interface Props {
    onClose: () => void
  }
  let { onClose }: Props = $props()

  type Tab = 'general' | 'soul' | 'memory'
  let activeTab = $state<Tab>('general')

  const memCount = $derived($memories.length)

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="overlay"
  role="dialog"
  aria-modal="true"
  aria-label="设置"
  tabindex="-1"
  onkeydown={handleKeydown}
  onclick={onClose}
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onkeydown={() => {}} onclick={(e) => e.stopPropagation()}>
    <!-- Header: tab bar + utility buttons -->
    <div class="modal-header">
      <div class="tabs">
        <button
          class="tab"
          class:active={activeTab === 'general'}
          onclick={() => (activeTab = 'general')}
        >通用</button>
        <button
          class="tab"
          class:active={activeTab === 'soul'}
          onclick={() => (activeTab = 'soul')}
        >灵魂</button>
        <button
          class="tab"
          class:active={activeTab === 'memory'}
          onclick={() => (activeTab = 'memory')}
        >
          记忆
          {#if memCount > 0}
            <span class="badge">{memCount}</span>
          {/if}
        </button>
      </div>
      <div class="header-actions">
        <a
          href="/files"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-icon"
          aria-label="文件浏览器"
          title="文件浏览器"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
          </svg>
        </a>
        <button class="btn-icon" aria-label="关闭设置" onclick={onClose}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Body: swap tab content -->
    <div class="modal-body">
      {#if activeTab === 'general'}
        <SettingsGeneral {onClose} />
      {:else if activeTab === 'soul'}
        <SettingsSoul />
      {:else}
        <SettingsMemory />
      {/if}
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }

  .modal {
    background: var(--surface-main);
    border: 1px solid var(--border);
    border-radius: 14px;
    width: 100%;
    max-width: 540px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 0;
    border-bottom: 1px solid var(--border);
    gap: 12px;
  }

  .tabs {
    display: flex;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 8px 16px 12px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tab:hover {
    color: var(--text-primary);
  }
  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .badge {
    background: var(--accent);
    color: white;
    border-radius: 100px;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 6px;
    line-height: 1.4;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .btn-icon {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 4px;
    border-radius: 6px;
    display: flex;
    flex-shrink: 0;
    transition: all 0.1s;
    text-decoration: none;
  }
  .btn-icon:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .modal-body {
    padding: 20px 24px;
    overflow-y: auto;
    flex: 1;
  }

  /* ── Mobile: bottom sheet ── */
  @media (max-width: 639px) {
    .overlay {
      align-items: flex-end;
      padding: 0;
    }
    .modal {
      border-radius: 18px 18px 0 0;
      max-width: 100%;
      max-height: 88svh;
    }
    .modal-header {
      padding: 14px 16px 0;
    }
    .tab {
      padding: 8px 10px 12px;
      font-size: 0.82rem;
    }
    .modal-body {
      padding: 16px;
    }
  }
</style>
