<script lang="ts">
  import { settings, MODELS } from '$lib/stores/settings';

  function handleChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    settings.update((s) => ({ ...s, model: id }));
  }
</script>

<div class="model-switcher">
  <svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
  </svg>
  <select value={$settings.model} onchange={handleChange} aria-label="选择模型">
    {#each MODELS as model (model.id)}
      <option value={model.id}>{model.name}</option>
    {/each}
  </select>
  <svg class="chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
</div>

<style>
  .model-switcher {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 28px 5px 10px;
    transition: border-color 0.15s;
  }

  .model-switcher:focus-within {
    border-color: var(--accent);
  }

  .icon {
    color: var(--text-muted);
    flex-shrink: 0;
    pointer-events: none;
  }

  select {
    appearance: none;
    background: none;
    border: none;
    outline: none;
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    /* Enough width for the longest model name without being too wide */
    max-width: 200px;
  }

  /* Chevron arrow overlaid on the right side */
  .chevron {
    position: absolute;
    right: 8px;
    color: var(--text-muted);
    pointer-events: none;
    flex-shrink: 0;
  }
</style>
