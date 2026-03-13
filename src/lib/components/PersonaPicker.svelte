<script lang="ts">
  import { BUILTIN_PERSONAS } from '$lib/agent/personas'
  import { activeConversation, setConversationPersona } from '$lib/stores/chat'

  const currentPersonaId = $derived($activeConversation?.personaId ?? null)

  async function select(id: string | null) {
    // Toggle off if clicking the already-selected persona
    await setConversationPersona(id === currentPersonaId ? null : id)
  }
</script>

<div class="persona-picker">
  <p class="hint">为当前会话选择一个角色（可选）</p>

  <div class="cards">
    {#each BUILTIN_PERSONAS as persona (persona.id)}
      <button
        class="card"
        class:selected={currentPersonaId === persona.id}
        onclick={() => select(persona.id)}
        type="button"
      >
        <span class="card-name">{persona.name}</span>
        <span class="card-desc">{persona.description}</span>
      </button>
    {/each}
  </div>

  {#if currentPersonaId}
    <button class="btn-clear" onclick={() => select(null)} type="button"> 清除角色 </button>
  {/if}
</div>

<style>
  .persona-picker {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 48px 0 32px;
  }

  .hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }

  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: center;
    max-width: 560px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 16px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
    width: 180px;
    transition: all 0.15s;
    color: var(--text-primary);
  }

  .card:hover {
    border-color: var(--accent);
    background: var(--surface-hover);
  }

  .card.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface-elevated));
  }

  .card-name {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .card.selected .card-name {
    color: var(--accent);
  }

  .card-desc {
    font-size: 0.775rem;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .btn-clear {
    background: none;
    border: none;
    font-size: 0.775rem;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
    transition: all 0.1s;
  }

  .btn-clear:hover {
    color: var(--error);
    background: var(--error-bg);
  }
</style>
