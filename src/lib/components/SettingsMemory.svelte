<script lang="ts">
  import { X, Plus } from 'lucide-svelte'
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

<p class="text-[0.825rem] text-fg-muted mb-3.5 leading-[1.5]">
  记忆用于存储用户的稳定身份信息（姓名、语言、长期偏好）。AI 通过
  <code
    class="bg-surface-elevated border border-line rounded px-1.5 py-px text-[0.8rem] text-fg-sub"
    >memory_save</code
  >
  /
  <code
    class="bg-surface-elevated border border-line rounded px-1.5 py-px text-[0.8rem] text-fg-sub"
    >memory_delete</code
  >
  自动管理，您也可以在此手动操作。 记忆在每次对话的 system prompt 中自动注入。
</p>

<div class="flex gap-2 mb-3.5">
  <input
    type="text"
    bind:value={newContent}
    placeholder="添加记忆…"
    class="flex-1 bg-surface-input border border-line rounded-lg px-3 py-2 text-[0.9rem]
           text-fg font-[inherit] outline-none transition-colors duration-150 box-border
           focus:border-accent"
    onkeydown={handleKeydown}
  />
  <button
    class="flex items-center gap-1.5 bg-accent border-none rounded-lg px-4 text-[0.875rem]
           cursor-pointer text-white font-medium whitespace-nowrap transition-opacity duration-100
           hover:opacity-85 disabled:opacity-40 disabled:cursor-not-allowed"
    onclick={add}
    disabled={adding || !newContent.trim()}
    type="button"
  >
    <Plus size={14} />
    添加
  </button>
</div>

{#if memList.length === 0}
  <p class="text-[0.85rem] text-fg-muted text-center py-6 m-0">
    暂无记忆。AI 会在对话中自动保存信息。
  </p>
{:else}
  <ul class="list-none m-0 p-0 flex flex-col gap-1.5">
    {#each memList as mem (mem.id)}
      <li
        class="flex items-start gap-2 bg-surface-elevated border border-line rounded-lg
                 px-3 py-2.5"
      >
        <span class="text-[0.72rem] text-fg-muted whitespace-nowrap pt-px tabular-nums">
          {new Date(mem.createdAt).toLocaleDateString('en-CA')}
        </span>
        <span class="flex-1 text-[0.85rem] text-fg leading-[1.5] break-words">
          {mem.content}
        </span>
        <button
          class="bg-transparent border-none cursor-pointer text-fg-muted p-0.5 rounded
                 flex shrink-0 transition-all duration-100 hover:text-error hover:bg-error-bg"
          onclick={() => memories.remove(mem.id)}
          aria-label="删除记忆"
          type="button"
        >
          <X size={13} />
        </button>
      </li>
    {/each}
  </ul>
{/if}
