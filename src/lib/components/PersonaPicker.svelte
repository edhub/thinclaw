<script lang="ts">
  import { BUILTIN_PERSONAS } from '$lib/agent/personas'
  import { activeConversation, setConversationPersona } from '$lib/stores/chat'

  const currentPersonaId = $derived($activeConversation?.personaId ?? null)

  async function handleChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value
    await setConversationPersona(value || null)
  }
</script>

<div class="flex items-center gap-2.5 pt-8 justify-center">
  <label class="text-xs text-fg-muted opacity-70 whitespace-nowrap" for="persona-select">
    角色
  </label>
  <select
    id="persona-select"
    value={currentPersonaId ?? ''}
    onchange={handleChange}
    class="bg-surface-input text-fg border border-line rounded-lg px-2.5 py-1.5 text-[0.82rem]
           cursor-pointer outline-none transition-colors duration-150 max-w-[260px]
           hover:border-accent focus:border-accent"
  >
    <option value="">无（默认）</option>
    {#each BUILTIN_PERSONAS as persona (persona.id)}
      <option value={persona.id}>{persona.name} — {persona.description}</option>
    {/each}
  </select>
</div>
