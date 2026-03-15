<script lang="ts">
  import { memories } from '$lib/stores/memory'
  import type { Memory } from '$lib/stores/memory'

  let memList = $derived([...$memories])
  let coreList = $derived(memList.filter((m) => (m.tier ?? 'general') === 'core'))
  let generalList = $derived(memList.filter((m) => (m.tier ?? 'general') === 'general'))

  let newContent = $state('')
  let newTier = $state<'core' | 'general'>('general')
  let adding = $state(false)

  async function add() {
    const content = newContent.trim()
    if (!content) return
    adding = true
    await memories.add(content, newTier)
    newContent = ''
    adding = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      add()
    }
  }

  function tierLabel(m: Memory) {
    return (m.tier ?? 'general') === 'core' ? '核心' : '一般'
  }
</script>

<p class="description">
  <strong>核心记忆</strong>（身份信息、长期偏好）每次对话自动注入。
  <strong>一般记忆</strong>（项目、事件、临时上下文）由 AI 按需通过
  <code>memory_recall</code> 检索。AI 通过 <code>memory_save</code> /
  <code>memory_delete</code> 自动管理，您也可以在此手动操作。
</p>

<div class="add-row">
  <input type="text" bind:value={newContent} placeholder="添加记忆…" onkeydown={handleKeydown} />
  <select bind:value={newTier} class="tier-select" aria-label="记忆类型">
    <option value="general">一般</option>
    <option value="core">核心</option>
  </select>
  <button class="btn-add" onclick={add} disabled={adding || !newContent.trim()} type="button">
    添加
  </button>
</div>

{#if memList.length === 0}
  <p class="empty">暂无记忆。AI 会在对话中自动保存信息。</p>
{:else}
  {#if coreList.length > 0}
    <p class="group-label">核心 · 始终注入</p>
    <ul class="list">
      {#each coreList as mem (mem.id)}
        <li class="item">
          <span class="badge core">{tierLabel(mem)}</span>
          <span class="date">{new Date(mem.createdAt).toLocaleDateString('en-CA')}</span>
          <span class="content">{mem.content}</span>
          <button
            class="btn-del"
            onclick={() => memories.remove(mem.id)}
            aria-label="删除记忆"
            type="button"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if generalList.length > 0}
    <p class="group-label" class:has-top-gap={coreList.length > 0}>一般 · 按需检索</p>
    <ul class="list">
      {#each generalList as mem (mem.id)}
        <li class="item">
          <span class="badge general">{tierLabel(mem)}</span>
          <span class="date">{new Date(mem.createdAt).toLocaleDateString('en-CA')}</span>
          <span class="content">{mem.content}</span>
          <button
            class="btn-del"
            onclick={() => memories.remove(mem.id)}
            aria-label="删除记忆"
            type="button"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .description {
    font-size: 0.825rem;
    color: var(--text-muted);
    margin: 0 0 14px;
    line-height: 1.5;
  }
  .description strong {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .description code {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .add-row {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }
  .add-row input {
    flex: 1;
    background: var(--surface-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 0.9rem;
    color: var(--text-primary);
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }
  .add-row input:focus {
    border-color: var(--accent);
  }

  .tier-select {
    background: var(--surface-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0 10px;
    font-size: 0.85rem;
    color: var(--text-secondary);
    font-family: inherit;
    cursor: pointer;
    outline: none;
    transition: border-color 0.15s;
    white-space: nowrap;
  }
  .tier-select:focus {
    border-color: var(--accent);
  }

  .btn-add {
    background: var(--accent);
    border: none;
    border-radius: 8px;
    padding: 0 18px;
    font-size: 0.875rem;
    cursor: pointer;
    color: white;
    font-weight: 500;
    white-space: nowrap;
    transition: opacity 0.1s;
  }
  .btn-add:hover:not(:disabled) {
    opacity: 0.85;
  }
  .btn-add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .group-label {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 0 0 6px;
  }
  .group-label.has-top-gap {
    margin-top: 14px;
  }

  .empty {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0;
    text-align: center;
    padding: 24px 0;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
  }

  .badge {
    font-size: 0.68rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    white-space: nowrap;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .badge.core {
    background: color-mix(in srgb, var(--accent) 15%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .badge.general {
    background: var(--surface-active);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .date {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
    padding-top: 1px;
    font-variant-numeric: tabular-nums;
  }

  .content {
    flex: 1;
    font-size: 0.85rem;
    color: var(--text-primary);
    line-height: 1.5;
    word-break: break-word;
  }

  .btn-del {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 2px;
    border-radius: 4px;
    display: flex;
    flex-shrink: 0;
    transition: all 0.1s;
  }
  .btn-del:hover {
    color: var(--error);
    background: var(--error-bg);
  }
</style>
