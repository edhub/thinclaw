<script lang="ts">
  import { settings, MODELS, modelKey, getAvailableModels, updateSettings } from '$lib/stores/settings'

  const availableModels = $derived(getAvailableModels($settings))
  const currentKey = $derived($settings.model ?? modelKey(availableModels[0]) ?? '')

  function handleChange(e: Event) {
    updateSettings({ model: (e.target as HTMLSelectElement).value })
  }
</script>

<select
  class="model-select"
  onchange={handleChange}
  title="切换模型"
  aria-label="切换模型"
>
  {#each availableModels as model (modelKey(model))}
    <option value={modelKey(model)} selected={modelKey(model) === currentKey}>{model.name}</option>
  {/each}
</select>

<style>
  .model-select {
    height: 28px;
    max-width: 160px;
    padding: 0 6px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: inherit;
    cursor: pointer;
    outline: none;
    transition: border-color 0.15s, color 0.15s;
  }

  .model-select:hover,
  .model-select:focus {
    border-color: var(--accent);
    color: var(--text-primary);
  }
</style>
