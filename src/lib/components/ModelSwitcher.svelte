<script lang="ts">
  import { Cpu, ChevronDown } from 'lucide-svelte'
  import {
    settings,
    MODELS,
    modelKey,
    getAvailableModels,
    updateSettings,
  } from '$lib/stores/settings'
  import { get } from 'svelte/store'

  let open = $state(false)
  let btnEl = $state<HTMLButtonElement | undefined>(undefined)

  let availableModels = $state(getAvailableModels(get(settings)))
  $effect(() => {
    availableModels = getAvailableModels($settings)
  })

  const currentModel = $derived(
    MODELS.find((m) => modelKey(m) === $settings.model) ?? availableModels[0] ?? MODELS[0],
  )

  function select(key: string) {
    updateSettings({ model: key })
    open = false
  }

  function handleDocClick(e: MouseEvent) {
    if (btnEl && !btnEl.closest('.model-switcher-wrap')?.contains(e.target as Node)) {
      open = false
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('click', handleDocClick)
      return () => document.removeEventListener('click', handleDocClick)
    }
  })
</script>

<div class="model-switcher-wrap relative">
  <button
    bind:this={btnEl}
    class="flex items-center justify-center w-[30px] h-[30px] bg-transparent border-none
           rounded-lg cursor-pointer text-fg-muted transition-all duration-150
           hover:bg-surface-hover hover:text-fg"
    class:active={open}
    onclick={() => (open = !open)}
    aria-label="切换模型：{currentModel.name}"
    title={currentModel.name}
  >
    <Cpu size={15} />
  </button>

  {#if open}
    <div
      class="absolute top-[calc(100%+6px)] right-0 min-w-[260px] bg-surface-elevated
                border border-line rounded-xl p-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-50"
    >
      {#each availableModels as model (modelKey(model))}
        <button
          class="flex items-center justify-between w-full bg-transparent border-none rounded-lg
                 px-2 py-1.5 text-[0.85rem] text-fg-sub cursor-pointer text-left transition-all
                 duration-100 gap-2 whitespace-nowrap hover:bg-surface-hover hover:text-fg"
          class:selected={modelKey(model) === $settings.model}
          role="menuitem"
          onclick={() => select(modelKey(model))}
        >
          {model.name}
          {#if modelKey(model) === $settings.model}
            <ChevronDown size={14} class="opacity-60" />
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .active {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .selected {
    color: var(--accent);
    font-weight: 600;
  }
</style>
