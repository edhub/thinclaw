<script lang="ts">
  import { settings, MODELS, type Theme } from '$lib/stores/settings';
  import { soul, DEFAULT_SOUL } from '$lib/agent/soul';
  import { memories, type Memory } from '$lib/stores/memory';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  // ── tabs ───────────────────────────────────────────────────────────────────
  type Tab = 'general' | 'soul' | 'memory';
  let activeTab = $state<Tab>('general');

  // ── general tab ────────────────────────────────────────────────────────────
  let draft = $state({ ...$settings });
  let showKey = $state(false);

  function saveGeneral() {
    settings.set({ ...draft });
    onClose();
  }

  // ── soul tab ───────────────────────────────────────────────────────────────
  let soulDraft = $state($soul);
  let soulSaved = $state(false);

  function saveSoul() {
    soul.set(soulDraft);
    soulSaved = true;
    setTimeout(() => (soulSaved = false), 1800);
  }

  function resetSoul() {
    if (confirm('确定恢复灵魂到内置默认值？此操作不可撤销。')) {
      soulDraft = DEFAULT_SOUL;
      soul.reset();
    }
  }

  // ── memory tab ─────────────────────────────────────────────────────────────
  let memList = $derived([...$memories]);
  let newMemContent = $state('');
  let memAdding = $state(false);

  async function addMemory() {
    const content = newMemContent.trim();
    if (!content) return;
    memAdding = true;
    await memories.add(content);
    newMemContent = '';
    memAdding = false;
  }

  async function removeMemory(id: string) {
    await memories.remove(id);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  function handleMemInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addMemory();
    }
  }

  const themes: { value: Theme; label: string }[] = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ];
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="overlay" role="dialog" aria-modal="true" aria-label="设置" tabindex="-1" onkeydown={handleKeydown} onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal" onkeydown={() => {}} onclick={(e) => e.stopPropagation()}>

    <!-- Header -->
    <div class="modal-header">
      <div class="tabs">
        <button class="tab" class:active={activeTab === 'general'} onclick={() => (activeTab = 'general')}>通用</button>
        <button class="tab" class:active={activeTab === 'soul'} onclick={() => (activeTab = 'soul')}>灵魂</button>
        <button class="tab" class:active={activeTab === 'memory'} onclick={() => (activeTab = 'memory')}>
          记忆
          {#if memList.length > 0}
            <span class="badge">{memList.length}</span>
          {/if}
        </button>
      </div>
      <button class="btn-close" aria-label="关闭设置" onclick={onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Body -->
    <div class="modal-body">

      <!-- ── General ── -->
      {#if activeTab === 'general'}
        <div class="field">
          <label for="api-key">API 密钥</label>
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
              {showKey ? '隐藏' : '显示'}
            </button>
          </div>
          <p class="field-hint">存储在您的浏览器本地，仅发送至 AI API。</p>
        </div>

        <div class="field">
          <label for="model">模型</label>
          <select id="model" bind:value={draft.model}>
            {#each MODELS as m (m.id)}
              <option value={m.id}>{m.name}</option>
            {/each}
          </select>
        </div>

        <div class="field">
          <label for="system-prompt">自定义指令 <span class="label-hint">（附加到灵魂）</span></label>
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
      {/if}

      <!-- ── Soul ── -->
      {#if activeTab === 'soul'}
        <p class="tab-description">
          这是 AI 的身份设定——包括其价值观、个性和行为准则。
          AI 可以通过 <code>soul_update</code> 工具自主更新，您也可以直接在此编辑。
        </p>
        <div class="field soul-field">
          <textarea
            class="soul-textarea"
            bind:value={soulDraft}
            spellcheck="false"
            rows="18"
          ></textarea>
        </div>
        <div class="soul-actions">
          <button class="btn-reset" onclick={resetSoul} type="button">恢复默认</button>
          <button class="btn-save-soul" onclick={saveSoul} type="button">
            {soulSaved ? '✓ 已保存' : '保存灵魂'}
          </button>
        </div>
      {/if}

      <!-- ── Memory ── -->
      {#if activeTab === 'memory'}
        <p class="tab-description">
          持久记忆会注入到每次对话中。AI 会通过 <code>memory_save</code> / <code>memory_delete</code> 工具自动管理，您也可以在此手动添加或删除。
        </p>

        <!-- Add memory -->
        <div class="mem-add-row">
          <input
            type="text"
            bind:value={newMemContent}
            placeholder="添加记忆…"
            onkeydown={handleMemInputKeydown}
          />
          <button class="btn-add-mem" onclick={addMemory} disabled={memAdding || !newMemContent.trim()} type="button">
            添加
          </button>
        </div>

        <!-- Memory list -->
        {#if memList.length === 0}
          <p class="mem-empty">暂无记忆。AI 会在对话中自动保存信息。</p>
        {:else}
          <ul class="mem-list">
            {#each memList as mem (mem.id)}
              <li class="mem-item">
                <span class="mem-date">{new Date(mem.createdAt).toLocaleDateString('en-CA')}</span>
                <span class="mem-content">{mem.content}</span>
                <button class="btn-del-mem" onclick={() => removeMemory(mem.id)} aria-label="删除记忆" type="button">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

    </div>

    <!-- Footer (General only) -->
    {#if activeTab === 'general'}
      <div class="modal-footer">
        <button class="btn-cancel" onclick={onClose}>取消</button>
        <button class="btn-save" onclick={saveGeneral}>保存</button>
      </div>
    {/if}

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
    max-width: 540px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 24px 64px rgba(0,0,0,0.3);
  }

  /* Header */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 0;
    border-bottom: 1px solid var(--border);
    gap: 12px;
  }

  .tabs {
    display: flex;
    gap: 0;
  }

  .tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 8px 16px 12px;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

  .badge {
    background: var(--accent);
    color: white;
    border-radius: 100px;
    font-size: 0.7rem;
    font-weight: 600;
    padding: 1px 6px;
    line-height: 1.4;
  }

  .btn-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 4px;
    border-radius: 6px;
    display: flex;
    flex-shrink: 0;
    transition: all 0.1s;
  }
  .btn-close:hover { background: var(--surface-hover); color: var(--text-primary); }

  /* Body */
  .modal-body {
    padding: 20px 24px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
    flex: 1;
  }

  .tab-description {
    font-size: 0.825rem;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.5;
  }
  .tab-description code {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 0.8rem;
    color: var(--text-secondary);
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

  /* Soul tab */
  .soul-field { flex: 1; }

  .soul-textarea {
    font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
    font-size: 0.82rem;
    line-height: 1.6;
    resize: vertical;
    min-height: 320px;
  }

  .soul-actions {
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
  .btn-reset:hover { color: var(--error); border-color: var(--error); }

  .btn-save-soul {
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
  .btn-save-soul:hover { opacity: 0.85; }

  /* Memory tab */
  .mem-add-row {
    display: flex;
    gap: 8px;
  }
  .mem-add-row input { flex: 1; }

  .btn-add-mem {
    background: var(--accent);
    border: none;
    border-radius: 8px;
    padding: 0 18px;
    font-size: 0.875rem;
    cursor: pointer;
    color: white;
    font-weight: 500;
    white-space: nowrap;
    transition: opacity 0.1s;
  }
  .btn-add-mem:hover:not(:disabled) { opacity: 0.85; }
  .btn-add-mem:disabled { opacity: 0.4; cursor: not-allowed; }

  .mem-empty {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin: 0;
    text-align: center;
    padding: 24px 0;
  }

  .mem-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .mem-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
  }

  .mem-date {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
    padding-top: 1px;
    font-variant-numeric: tabular-nums;
  }

  .mem-content {
    flex: 1;
    font-size: 0.85rem;
    color: var(--text-primary);
    line-height: 1.5;
    word-break: break-word;
  }

  .btn-del-mem {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted);
    padding: 2px;
    border-radius: 4px;
    display: flex;
    flex-shrink: 0;
    transition: all 0.1s;
  }
  .btn-del-mem:hover { color: var(--error); background: var(--error-bg); }

  /* Footer */
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 24px 18px;
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

  /* ── Mobile: bottom sheet ── */
  @media (max-width: 639px) {
    .overlay {
      align-items: flex-end;
      padding: 0;
    }

    .modal {
      border-radius: 18px 18px 0 0;
      max-width: 100%;
      /* svh avoids the iOS Safari toolbar collapsing issue */
      max-height: 88svh;
    }

    .modal-header {
      padding: 14px 16px 0;
    }

    .tab {
      padding: 8px 10px 12px;
      font-size: 0.82rem;
    }

    .modal-body {
      padding: 16px;
    }

    .modal-footer {
      padding: 12px 16px 20px;
    }

    .soul-textarea {
      min-height: 180px;
    }
  }
</style>
