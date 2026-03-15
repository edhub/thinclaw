<script lang="ts">
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

  // Use $state + $effect instead of $derived so that store changes from other
  // pages (e.g. /settings) are always reflected when the dropdown opens.
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

<div class="model-switcher-wrap">
  <button
    bind:this={btnEl}
    class="trigger"
    class:active={open}
    onclick={() => (open = !open)}
    aria-label="切换模型：{currentModel.name}"
    title={currentModel.name}
  >
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path
        d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"
      />
    </svg>
  </button>

  {#if open}
    <div class="dropdown" role="menu">
      {#each availableModels as model (modelKey(model))}
        <button
          class="option"
          class:selected={modelKey(model) === $settings.model}
          role="menuitem"
          onclick={() => select(modelKey(model))}
        >
          {model.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .model-switcher-wrap {
    position: relative;
  }

  .trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    background: none;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.15s;
  }

  .trigger:hover,
  .trigger.active {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 260px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    z-index: 50;
  }

  .option {
    display: flex;
    align-items: center;
    white-space: nowrap;
    justify-content: space-between;
    width: 100%;
    background: none;
    border: none;
    border-radius: 7px;
    padding: 6px 8px;
    font-size: 0.85rem;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
    transition: all 0.1s;
    gap: 8px;
  }

  .option:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .option.selected {
    color: var(--accent);
    font-weight: 600;
  }
</style>
