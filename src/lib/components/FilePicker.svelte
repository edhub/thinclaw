<script lang="ts">
  import type { FileEntry } from '$lib/fs/mention';

  interface Props {
    files: FileEntry[];
    selectedIndex: number;
    onSelect: (file: FileEntry) => void;
  }
  let { files, selectedIndex, onSelect }: Props = $props();

  let listEl = $state<HTMLDivElement | undefined>(undefined);

  // Keep the active item visible when keyboard-navigating.
  $effect(() => {
    void selectedIndex;
    const active = listEl?.querySelector<HTMLElement>('.item.active');
    active?.scrollIntoView({ block: 'nearest' });
  });
</script>

<div class="picker" bind:this={listEl} role="listbox" aria-label="选择文件">
  <div class="header">附加文件上下文</div>

  {#if files.length === 0}
    <div class="empty">未找到文件</div>
  {:else}
    {#each files as file, i}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="item"
        class:active={i === selectedIndex}
        role="option"
        aria-selected={i === selectedIndex}
        tabindex="-1"
        onmousedown={(e) => {
          // Prevent textarea blur before the click fires.
          e.preventDefault();
          onSelect(file);
        }}
      >
        <svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span class="name">{file.name}</span>
        {#if file.path !== file.name}
          <span class="path">{file.path}</span>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .picker {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    right: 0;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
    max-height: 236px;
    overflow-y: auto;
    z-index: 100;
  }

  .header {
    font-size: 0.7rem;
    color: var(--text-muted);
    padding: 8px 12px 4px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    border-bottom: 1px solid var(--border);
  }

  .empty {
    padding: 14px 12px;
    font-size: 0.875rem;
    color: var(--text-muted);
    text-align: center;
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    margin: 3px 4px;
    border-radius: 6px;
    cursor: pointer;
    user-select: none;
    transition: background 0.08s;
  }

  .item:hover,
  .item.active {
    background: var(--surface-active);
  }

  .icon {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .name {
    font-size: 0.875rem;
    color: var(--text-primary);
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .path {
    font-size: 0.75rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
</style>
