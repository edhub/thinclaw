<script lang="ts">
  import { soul, DEFAULT_SOUL } from '$lib/agent/soul'

  let draft = $state($soul)
  let saved = $state(false)

  function save() {
    soul.set(draft)
    saved = true
    setTimeout(() => (saved = false), 1800)
  }

  function reset() {
    if (confirm('确定恢复灵魂到内置默认值？此操作不可撤销。')) {
      draft = DEFAULT_SOUL
      soul.reset()
    }
  }
</script>

<p class="description">
  这是 AI 的身份设定——包括其价值观、个性和行为准则。AI 可以通过
  <code>soul_update</code> 工具自主更新，您也可以直接在此编辑。
</p>

<textarea class="editor" bind:value={draft} spellcheck="false" rows="18"></textarea>

<div class="actions">
  <button class="btn-reset" onclick={reset} type="button">恢复默认</button>
  <button class="btn-save" onclick={save} type="button">
    {saved ? '✓ 已保存' : '保存灵魂'}
  </button>
</div>

<style>
  .description {
    font-size: 0.825rem;
    color: var(--text-muted);
    margin: 0 0 14px;
    line-height: 1.5;
  }
  .description code {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }

  .editor {
    display: block;
    width: 100%;
    background: var(--surface-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
    font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 0.82rem;
    line-height: 1.6;
    color: var(--text-primary);
    resize: vertical;
    min-height: 320px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
    margin-bottom: 12px;
  }
  .editor:focus {
    border-color: var(--accent);
  }

  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .btn-reset {
    background: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 7px 14px;
    font-size: 0.85rem;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.1s;
  }
  .btn-reset:hover {
    color: var(--error);
    border-color: var(--error);
  }

  .btn-save {
    background: var(--accent);
    border: none;
    border-radius: 8px;
    padding: 7px 20px;
    font-size: 0.875rem;
    cursor: pointer;
    color: white;
    font-weight: 500;
    transition: opacity 0.1s;
  }
  .btn-save:hover {
    opacity: 0.85;
  }

  @media (max-width: 639px) {
    .editor {
      min-height: 180px;
    }
  }
</style>
