<script lang="ts">
  import { FileText } from 'lucide-svelte'
  import type { FileEntry } from '$lib/fs/mention'

  interface Props {
    files: FileEntry[]
    selectedIndex: number
    onSelect: (file: FileEntry) => void
  }
  let { files, selectedIndex, onSelect }: Props = $props()

  let listEl = $state<HTMLDivElement | undefined>(undefined)

  $effect(() => {
    void selectedIndex
    const active = listEl?.querySelector<HTMLElement>('.item.active')
    active?.scrollIntoView({ block: 'nearest' })
  })
</script>

<div
  class="absolute bottom-[calc(100%+6px)] left-0 right-0 bg-surface-elevated border border-line
         rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.12)] max-h-[236px] overflow-y-auto z-[100]"
  bind:this={listEl}
  role="listbox"
  aria-label="选择文件"
>
  <div
    class="text-[0.7rem] text-fg-muted px-3 pt-2 pb-1 font-semibold tracking-[0.06em]
              uppercase border-b border-line"
  >
    附加文件上下文
  </div>

  {#if files.length === 0}
    <div class="py-3.5 px-3 text-sm text-fg-muted text-center">未找到文件</div>
  {:else}
    {#each files as file, i}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="item flex items-center gap-2 px-2.5 py-[7px] mx-1 my-0.5 rounded-md cursor-pointer
               select-none transition-colors duration-[80ms]"
        class:active={i === selectedIndex}
        role="option"
        aria-selected={i === selectedIndex}
        tabindex="-1"
        onmousedown={(e) => {
          e.preventDefault()
          onSelect(file)
        }}
      >
        <FileText size={13} class="text-fg-muted flex-shrink-0" />
        <span class="text-sm text-fg font-medium whitespace-nowrap flex-shrink-0">{file.name}</span>
        {#if file.path !== file.name}
          <span
            class="text-[0.75rem] text-fg-muted overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
          >
            {file.path}
          </span>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .item:hover,
  .item.active {
    background: var(--surface-active);
  }
</style>
