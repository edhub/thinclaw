<script lang="ts">
  import { settings, type Theme } from '$lib/stores/settings'

  interface Props {
    onClose: () => void
  }
  let { onClose }: Props = $props()

  let draft = $state({ ...$settings })
  let showKey = $state(false)

  function save() {
    settings.set({ ...draft })
    onClose()
  }

  const themes: { value: Theme; label: string }[] = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ]
</script>

<div class="fields">
  <div class="field">
    <label for="api-key">API 密钥</label>
    <div class="key-wrap">
      <input
        id="api-key"
        type={showKey ? 'text' : 'password'}
        bind:value={draft.apiKey}
        placeholder="sk-..."
        autocomplete="off"
        spellcheck="false"
      />
      <button class="btn-toggle" onclick={() => (showKey = !showKey)} type="button">
        {showKey ? '隐藏' : '显示'}
      </button>
    </div>
    <p class="hint">存储在您的浏览器本地，仅发送至 AI API。</p>
  </div>

  <div class="field">
    <label for="system-prompt">自定义指令 <span class="label-sub">（附加到灵魂）</span></label>
    <textarea
      id="system-prompt"
      bind:value={draft.systemPrompt}
      rows="3"
      placeholder="可选：添加额外行为说明…"
    ></textarea>
  </div>

  <div class="field">
    <label for="theme">主题</label>
    <select id="theme" bind:value={draft.theme}>
      {#each themes as t (t.value)}
        <option value={t.value}>{t.label}</option>
      {/each}
    </select>
  </div>
</div>

<div class="footer">
  <button class="btn-cancel" onclick={onClose}>取消</button>
  <button class="btn-save" onclick={save}>保存</button>
</div>

<style>
  .fields {
    display: flex;
    flex-direction: column;
    gap: 16px;
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

  .label-sub {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  input,
  select,
  textarea {
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
  input:focus,
  select:focus,
  textarea:focus {
    border-color: var(--accent);
  }
  textarea {
    resize: vertical;
    min-height: 70px;
  }

  .key-wrap {
    display: flex;
    gap: 8px;
  }
  .key-wrap input {
    flex: 1;
  }

  .btn-toggle {
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
  .btn-toggle:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin: 0;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    margin-top: 4px;
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
  .btn-cancel:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

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
  .btn-save:hover {
    opacity: 0.85;
  }
</style>
