<script lang="ts">
  import { memories } from '$lib/stores/memory'

  let memList = $derived([...$memories])

  let newContent = $state('')
  let adding = $state(false)

  async function add() {
    const content = newContent.trim()
    if (!content) return
    adding = true
    await memories.add(content)
    newContent = ''
    adding = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      add()
    }
  }
</script>

<p class="description">
  记忆用于存储用户的稳定身份信息（姓名、语言、长期偏好）。AI 通过
  <code>memory_save</code> / <code>memory_delete</code> 自动管理，您也可以在此手动操作。
  记忆在每次对话的 system prompt 中自动注入。
</p>

<div class="add-row">
  <input type="text" bind:value={newContent} placeholder="添加记忆…" onkeydown={handleKeydown} />
  <button class="btn-add" onclick={add} disabled={adding || !newContent.trim()} type="button">
    添加
  </button>
</div>

{#if memList.length === 0}
  <p class="empty">暂无记忆。AI 会在对话中自动保存信息。</p>
{:else}
  <ul class="list">
    {#each memList as mem (mem.id)}
      <li class="item">
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

<style>
  .description {
    font-size: 0.825rem;
    color: var(--text-muted);
    margin: 0 0 14px;
    line-height: 1.5;
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
