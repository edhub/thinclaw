<script lang="ts">
  import { settings, MODELS, PERSONAS, type Theme } from '$lib/stores/settings';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  let draft = $state({ ...$settings });
  let showKey = $state(false);

  function save() {
    settings.set({ ...draft });
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  const themes: { value: Theme; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1" onkeydown={handleKeydown}>
  <div class="modal">
    <div class="modal-header">
      <h2>Settings</h2>
      <button class="btn-close" aria-label="Close settings" onclick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="modal-body">
      <!-- API Key -->
      <div class="field">
        <label for="api-key">API Key</label>
        <div class="key-input-wrap">
          <input
            id="api-key"
            type={showKey ? 'text' : 'password'}
            bind:value={draft.apiKey}
            placeholder="sk-..."
            autocomplete="off"
            spellcheck="false"
          />
          <button class="btn-toggle-key" onclick={() => (showKey = !showKey)} type="button">
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <p class="field-hint">Stored locally in your browser. Never sent anywhere except the AI API.</p>
      </div>

      <!-- Model -->
      <div class="field">
        <label for="model">Model</label>
        <select id="model" bind:value={draft.model}>
          {#each MODELS as m (m.id)}
            <option value={m.id}>{m.name}</option>
          {/each}
        </select>
      </div>

      <!-- Persona -->
      <div class="field">
        <label id="persona-label" for="persona-group">Persona</label>
        <div id="persona-group" class="persona-grid" role="group" aria-labelledby="persona-label">
          {#each PERSONAS as p (p.id)}
            <button
              class="persona-card"
              class:selected={draft.personaId === p.id}
              type="button"
              onclick={() => (draft.personaId = p.id)}
            >
              <span class="persona-emoji">{p.emoji}</span>
              <span class="persona-name">{p.name}</span>
              <span class="persona-desc">{p.description}</span>
            </button>
          {/each}
        </div>
      </div>

      <!-- Custom system prompt -->
      <div class="field">
        <label for="system-prompt">自定义指令 <span class="label-hint">（追加到 Persona 末尾）</span></label>
        <textarea
          id="system-prompt"
          bind:value={draft.systemPrompt}
          rows="3"
          placeholder="可选：添加额外的行为说明…"
        ></textarea>
      </div>

      <!-- Theme -->
      <div class="field">
        <label for="theme">Theme</label>
        <select id="theme" bind:value={draft.theme}>
          {#each themes as t (t.value)}
            <option value={t.value}>{t.label}</option>
          {/each}
        </select>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn-cancel" onclick={onClose}>Cancel</button>
      <button class="btn-save" onclick={save}>Save</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }

  .modal {
    background: var(--surface-main);
    border: 1px solid var(--border);
    border-radius: 14px;
    width: 100%;
    max-width: 500px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0,0,0,0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1px solid var(--border);
  }

  h2 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    color: var(--text-primary);
  }

  .btn-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 4px;
    border-radius: 6px;
    display: flex;
    transition: all 0.1s;
  }
  .btn-close:hover { background: var(--surface-hover); color: var(--text-primary); }

  .modal-body {
    padding: 20px 24px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label {
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .label-hint {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  input, select, textarea {
    background: var(--surface-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 0.9rem;
    color: var(--text-primary);
    font-family: inherit;
    transition: border-color 0.15s;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  input:focus, select:focus, textarea:focus { border-color: var(--accent); }
  textarea { resize: vertical; min-height: 70px; }

  .key-input-wrap { display: flex; gap: 8px; }
  .key-input-wrap input { flex: 1; }

  .btn-toggle-key {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0 14px;
    font-size: 0.8rem;
    cursor: pointer;
    color: var(--text-secondary);
    white-space: nowrap;
    transition: all 0.1s;
  }
  .btn-toggle-key:hover { background: var(--surface-hover); color: var(--text-primary); }

  .field-hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin: 0;
  }

  /* Persona grid */
  .persona-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 8px;
  }

  .persona-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 8px;
    background: var(--surface-elevated);
    border: 2px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s;
    text-align: center;
  }
  .persona-card:hover { border-color: var(--accent); background: var(--surface-hover); }
  .persona-card.selected { border-color: var(--accent); background: var(--surface-active); }

  .persona-emoji { font-size: 1.4rem; }
  .persona-name { font-size: 0.8rem; font-weight: 600; color: var(--text-primary); }
  .persona-desc { font-size: 0.7rem; color: var(--text-muted); line-height: 1.3; }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 16px 24px 20px;
    border-top: 1px solid var(--border);
  }

  .btn-cancel {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 18px;
    font-size: 0.9rem;
    cursor: pointer;
    color: var(--text-secondary);
    transition: all 0.1s;
  }
  .btn-cancel:hover { background: var(--surface-hover); color: var(--text-primary); }

  .btn-save {
    background: var(--accent);
    border: none;
    border-radius: 8px;
    padding: 8px 18px;
    font-size: 0.9rem;
    cursor: pointer;
    color: white;
    font-weight: 500;
    transition: opacity 0.1s;
  }
  .btn-save:hover { opacity: 0.85; }
</style>
