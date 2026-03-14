<script lang="ts">
  import { BUILTIN_PERSONAS } from '$lib/agent/personas'
  import { activeConversation, setConversationPersona } from '$lib/stores/chat'

  const currentPersonaId = $derived($activeConversation?.personaId ?? null)

  async function handleChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value
    await setConversationPersona(value || null)
  }
</script>

<div class="persona-picker">
  <label class="label" for="persona-select">角色</label>
  <select id="persona-select" value={currentPersonaId ?? ''} onchange={handleChange}>
    <option value="">无（默认）</option>
    {#each BUILTIN_PERSONAS as persona (persona.id)}
      <option value={persona.id}>{persona.name} — {persona.description}</option>
    {/each}
  </select>
</div>

<style>
  .persona-picker {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 32px 0 0;
    justify-content: center;
  }

  .label {
    font-size: 0.75rem;
    color: var(--text-muted);
    opacity: 0.7;
    white-space: nowrap;
  }

  select {
    background: var(--surface-input);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 5px 10px;
    font-size: 0.82rem;
    cursor: pointer;
    outline: none;
    transition: border-color 0.15s;
    max-width: 260px;
  }

  select:hover {
    border-color: var(--accent);
  }

  select:focus {
    border-color: var(--accent);
  }
</style>
