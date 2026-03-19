<!--
  Settings page — full-page replacement for the modal.

  Sections (left sidebar / top tabs on mobile):
    供应商    API keys + per-provider model toggles
    模型配置  Default model + utility model dropdowns
    外观      Theme selector + custom system prompt
    灵魂      Soul editor (reuses SettingsSoul.svelte)
    记忆      Memory list (reuses SettingsMemory.svelte)
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'

  function closeSettings() {
    if (history.length > 1) {
      history.back()
    } else {
      goto('/')
    }
  }
  import { memories } from '$lib/stores/memory'
  import {
    settings,
    updateSettings,
    getAvailableModels,
    getKeyedModels,
    isModelEnabled,
    MODELS,
    modelKey,
    type Theme,
  } from '$lib/stores/settings'
  import SettingsSoul from '$lib/components/SettingsSoul.svelte'
  import SettingsMemory from '$lib/components/SettingsMemory.svelte'

  // ── Nav ───────────────────────────────────────────────────────────────────

  type Section = 'providers' | 'appearance' | 'soul' | 'memory'
  let activeSection = $state<Section>('providers')

  const NAV: { id: Section; label: string }[] = [
    { id: 'providers', label: '模型 & 供应商' },
    { id: 'appearance', label: '外观 & 指令' },
    { id: 'soul', label: '灵魂' },
    { id: 'memory', label: '记忆' },
  ]

  const memCount = $derived($memories.length)

  // ── Key inputs ────────────────────────────────────────────────────────────

  let laozhangKey = $state($settings.laozhangApiKey)
  let showLaozhang = $state(false)

  // Keep local draft in sync if the store is updated externally (e.g. auto-correct).
  $effect(() => { laozhangKey = $settings.laozhangApiKey })

  function saveLaozhangKey() {
    updateSettings({ laozhangApiKey: laozhangKey })
  }

  let bianxieKey = $state($settings.bianxieApiKey)
  let showBianxie = $state(false)

  // Keep local draft in sync if the store is updated externally.
  $effect(() => { bianxieKey = $settings.bianxieApiKey })

  function saveBianxieKey() {
    updateSettings({ bianxieApiKey: bianxieKey })
  }

  let lingyaaiKey = $state($settings.lingyaaiApiKey)
  let showLingyaai = $state(false)

  $effect(() => { lingyaaiKey = $settings.lingyaaiApiKey })

  function saveLingyaaiKey() {
    updateSettings({ lingyaaiApiKey: lingyaaiKey })
  }

  // ── Model toggles ─────────────────────────────────────────────────────────

  const laozhangModels = $derived(MODELS.filter((m) => m.provider === 'laozhang'))
  const bianxieModels = $derived(MODELS.filter((m) => m.provider === 'bianxie'))
  const lingyaaiModels = $derived(MODELS.filter((m) => m.provider === 'lingyaai'))

  function toggleModel(key: string): void {
    const s = $settings
    const keyed = getKeyedModels(s).map(modelKey)
    const effective =
      s.enabledModelKeys.length === 0
        ? keyed
        : s.enabledModelKeys

    let next: string[]
    if (effective.includes(key)) {
      next = effective.filter((k) => k !== key)
    } else {
      next = [...effective, key]
    }

    // If all keyed models are checked → reset to [] (means "all")
    const allEnabled = keyed.every((k) => next.includes(k))
    updateSettings({ enabledModelKeys: allEnabled ? [] : next })
  }

  // ── Derived states ────────────────────────────────────────────────────────

  const availableModels = $derived(getAvailableModels($settings))

  // ── Theme ─────────────────────────────────────────────────────────────────

  const themes: { value: Theme; label: string }[] = [
    { value: 'system', label: '跟随系统' },
    { value: 'light', label: '浅色' },
    { value: 'dark', label: '深色' },
  ]

  // ── System prompt ─────────────────────────────────────────────────────────

  let systemPromptDraft = $state($settings.systemPrompt)
  function saveSystemPrompt() {
    updateSettings({ systemPrompt: systemPromptDraft })
  }

  // ── Page title ────────────────────────────────────────────────────────────

  onMount(() => {
    document.title = 'Settings — ThinClaw'
  })
</script>

<div class="page">
  <!-- Top bar -->
  <header class="topbar">
    <h1 class="page-title">设置</h1>
    <button class="btn-close" onclick={closeSettings} type="button" aria-label="关闭设置">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </header>

  <!-- Mobile tab bar (outside .body so it sits above content, not beside sidebar) -->
  <div class="tab-bar" role="tablist">
    {#each NAV as item (item.id)}
      <button
        class="tab"
        class:active={activeSection === item.id}
        onclick={() => (activeSection = item.id)}
        role="tab"
        aria-selected={activeSection === item.id}
        type="button"
      >
        {item.label}
        {#if item.id === 'memory' && memCount > 0}
          <span class="nav-badge">{memCount}</span>
        {/if}
      </button>
    {/each}
  </div>

  <div class="body">
    <!-- Sidebar (desktop only) -->
    <nav class="sidebar" aria-label="设置导航">
      {#each NAV as item (item.id)}
        <button
          class="nav-item"
          class:active={activeSection === item.id}
          onclick={() => (activeSection = item.id)}
          type="button"
        >
          {item.label}
          {#if item.id === 'memory' && memCount > 0}
            <span class="nav-badge">{memCount}</span>
          {/if}
        </button>
      {/each}
    </nav>

    <!-- Content -->
    <main class="content">

      <!-- ── 模型 & 供应商 ─────────────────────────────────────────── -->
      {#if activeSection === 'providers'}
        <div class="section">
          <h2 class="section-title">模型 & 供应商</h2>
          <p class="section-desc">选择默认对话模型和工具模型，配置各供应商密钥并选择要启用的模型。</p>

          <!-- 模型配置 -->
          {#if availableModels.length === 0}
            <div class="empty-notice">
              没有可用模型。请先在下方配置 API 密钥。
            </div>
          {:else}
            <div class="field">
              <label for="default-model">默认对话模型</label>
              <select
                id="default-model"
                value={$settings.model}
                onchange={(e) => updateSettings({ model: (e.target as HTMLSelectElement).value })}
              >
                {#each availableModels as m (modelKey(m))}
                  <option value={modelKey(m)}>{m.name}</option>
                {/each}
              </select>
              <p class="hint">新建对话时默认使用的模型。</p>
            </div>

            <div class="field">
              <label for="utility-model">工具模型</label>
              <select
                id="utility-model"
                value={$settings.utilityModelKey}
                onchange={(e) => updateSettings({ utilityModelKey: (e.target as HTMLSelectElement).value })}
              >
                {#each availableModels as m (modelKey(m))}
                  <option value={modelKey(m)}>{m.name}</option>
                {/each}
              </select>
              <p class="hint">用于对话摘要和自动标题生成，推荐选速度快、成本低的模型。</p>
            </div>
          {/if}

          <div class="section-divider"></div>

          <!-- laozhang -->
          <div class="provider-card">
            <div class="provider-header">
              <div class="provider-name">
                老张 · laozhang.ai
                <span class="provider-status" class:ok={!!$settings.laozhangApiKey}>
                  {$settings.laozhangApiKey ? '✓ 已配置' : '未配置'}
                </span>
              </div>
            </div>
            {#if !$settings.laozhangApiKey}
              <div class="provider-notice">
                ⚠ 未配置密钥，该供应商下的模型和图像生成功能不可用。
              </div>
            {/if}
            <div class="field">
              <label for="laozhang-key">API 密钥</label>
              <div class="key-wrap">
                <input
                  id="laozhang-key"
                  type={showLaozhang ? 'text' : 'password'}
                  bind:value={laozhangKey}
                  placeholder="sk-..."
                  autocomplete="off"
                  spellcheck="false"
                  onblur={saveLaozhangKey}
                />
                <button class="btn-toggle" type="button" onclick={() => (showLaozhang = !showLaozhang)}>
                  {showLaozhang ? '隐藏' : '显示'}
                </button>
              </div>
              <p class="hint">密钥仅存储在您的浏览器本地，直接发送至 api.laozhang.ai。</p>
            </div>

            <div class="model-list-label">模型</div>
            <ul class="model-list">
              {#each laozhangModels as m (modelKey(m))}
                {@const enabled = isModelEnabled(m, $settings)}
                {@const hasKey = !!$settings.laozhangApiKey}
                <li class="model-row" class:disabled={!hasKey}>
                  <label class="model-label">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={!hasKey}
                      onchange={() => toggleModel(modelKey(m))}
                    />
                    <span class="model-name">{m.name}</span>
                    <span class="model-meta">
                      {#if m.reasoning}<span class="tag tag-reason">reasoning</span>{/if}
                      <span class="tag">{(m.contextWindow / 1000).toFixed(0)}K ctx</span>
                    </span>
                  </label>
                </li>
              {/each}
            </ul>
          </div>

          <!-- bianxie -->
          <div class="section-divider"></div>
          <div class="provider-card">
            <div class="provider-header">
              <div class="provider-name">
                边界 · bianxie.ai
                <span class="provider-status" class:ok={!!$settings.bianxieApiKey}>
                  {$settings.bianxieApiKey ? '✓ 已配置' : '未配置'}
                </span>
              </div>
            </div>
            {#if !$settings.bianxieApiKey}
              <div class="provider-notice">
                ⚠ 未配置密钥，该供应商下的模型不可用。
              </div>
            {/if}
            <div class="field">
              <label for="bianxie-key">API 密钥</label>
              <div class="key-wrap">
                <input
                  id="bianxie-key"
                  type={showBianxie ? 'text' : 'password'}
                  bind:value={bianxieKey}
                  placeholder="sk-..."
                  autocomplete="off"
                  spellcheck="false"
                  onblur={saveBianxieKey}
                />
                <button class="btn-toggle" type="button" onclick={() => (showBianxie = !showBianxie)}>
                  {showBianxie ? '隐藏' : '显示'}
                </button>
              </div>
              <p class="hint">密钥仅存储在您的浏览器本地，直接发送至 api.bianxie.ai。</p>
            </div>

            <div class="model-list-label">模型</div>
            <ul class="model-list">
              {#each bianxieModels as m (modelKey(m))}
                {@const enabled = isModelEnabled(m, $settings)}
                {@const hasKey = !!$settings.bianxieApiKey}
                <li class="model-row" class:disabled={!hasKey}>
                  <label class="model-label">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={!hasKey}
                      onchange={() => toggleModel(modelKey(m))}
                    />
                    <span class="model-name">{m.name}</span>
                    <span class="model-meta">
                      {#if m.reasoning}<span class="tag tag-reason">reasoning</span>{/if}
                      <span class="tag">{(m.contextWindow / 1000).toFixed(0)}K ctx</span>
                    </span>
                  </label>
                </li>
              {/each}
            </ul>
          </div>
          <!-- lingyaai -->
          <div class="section-divider"></div>
          <div class="provider-card">
            <div class="provider-header">
              <div class="provider-name">
                灵芽 · lingyaai.cn
                <span class="provider-status" class:ok={!!$settings.lingyaaiApiKey}>
                  {$settings.lingyaaiApiKey ? '✓ 已配置' : '未配置'}
                </span>
              </div>
            </div>
            {#if !$settings.lingyaaiApiKey}
              <div class="provider-notice">
                ⚠ 未配置密钥，该供应商下的模型不可用。
              </div>
            {/if}
            <div class="field">
              <label for="lingyaai-key">API 密钥</label>
              <div class="key-wrap">
                <input
                  id="lingyaai-key"
                  type={showLingyaai ? 'text' : 'password'}
                  bind:value={lingyaaiKey}
                  placeholder="sk-..."
                  autocomplete="off"
                  spellcheck="false"
                  onblur={saveLingyaaiKey}
                />
                <button class="btn-toggle" type="button" onclick={() => (showLingyaai = !showLingyaai)}>
                  {showLingyaai ? '隐藏' : '显示'}
                </button>
              </div>
              <p class="hint">密钥仅存储在您的浏览器本地，直接发送至 api.lingyaai.cn。</p>
            </div>

            <div class="model-list-label">模型</div>
            <ul class="model-list">
              {#each lingyaaiModels as m (modelKey(m))}
                {@const enabled = isModelEnabled(m, $settings)}
                {@const hasKey = !!$settings.lingyaaiApiKey}
                <li class="model-row" class:disabled={!hasKey}>
                  <label class="model-label">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={!hasKey}
                      onchange={() => toggleModel(modelKey(m))}
                    />
                    <span class="model-name">{m.name}</span>
                    <span class="model-meta">
                      {#if m.reasoning}<span class="tag tag-reason">reasoning</span>{/if}
                      <span class="tag">{(m.contextWindow / 1000).toFixed(0)}K ctx</span>
                    </span>
                  </label>
                </li>
              {/each}
            </ul>
          </div>
        </div>

      <!-- ── 外观 & 指令 ─────────────────────────────────────────────── -->
      {:else if activeSection === 'appearance'}
        <div class="section">
          <h2 class="section-title">外观 & 指令</h2>

          <div class="field">
            <label for="theme">主题</label>
            <div class="theme-options">
              {#each themes as t (t.value)}
                <button
                  class="theme-btn"
                  class:active={$settings.theme === t.value}
                  onclick={() => updateSettings({ theme: t.value })}
                  type="button"
                >
                  {t.label}
                </button>
              {/each}
            </div>
          </div>

          <div class="field">
            <label for="system-prompt">
              自定义指令
              <span class="label-sub">（附加到灵魂之后）</span>
            </label>
            <textarea
              id="system-prompt"
              bind:value={systemPromptDraft}
              rows="6"
              placeholder="可选：为 AI 添加额外的行为说明或约束…"
              onblur={saveSystemPrompt}
            ></textarea>
            <p class="hint">离开输入框时自动保存。</p>
          </div>
        </div>

      <!-- ── 灵魂 ──────────────────────────────────────────────────── -->
      {:else if activeSection === 'soul'}
        <div class="section">
          <h2 class="section-title">灵魂</h2>
          <SettingsSoul />
        </div>

      <!-- ── 记忆 ──────────────────────────────────────────────────── -->
      {:else if activeSection === 'memory'}
        <div class="section">
          <h2 class="section-title">记忆</h2>
          <SettingsMemory />
        </div>
      {/if}

    </main>
  </div>
</div>

<style>
  /* ── Layout ─────────────────────────────────────────────────────────────── */

  .page {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--surface-main);
    color: var(--text-primary);
    font-family: inherit;
  }

  /* ── Top bar ─────────────────────────────────────────────────────────────  */

  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 24px;
    height: 52px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .page-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    flex: 1;
  }

  .btn-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    transition: all 0.1s;
    flex-shrink: 0;
  }
  .btn-close:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  /* ── Body ────────────────────────────────────────────────────────────────  */

  .body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  /* ── Sidebar ─────────────────────────────────────────────────────────────  */

  .sidebar {
    width: 180px;
    flex-shrink: 0;
    padding: 16px 10px;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow-y: auto;
  }

  .nav-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    background: none;
    border: none;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 0.875rem;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
    transition: all 0.1s;
  }
  .nav-item:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .nav-item.active {
    background: var(--surface-active);
    color: var(--accent);
    font-weight: 500;
  }

  .nav-badge {
    background: var(--accent);
    color: white;
    border-radius: 100px;
    font-size: 0.68rem;
    font-weight: 600;
    padding: 1px 5px;
    line-height: 1.4;
  }

  /* ── Mobile: hide sidebar, show tab bar ──────────────────────────────────  */

  .tab-bar {
    display: none;
  }

  /* ── Content ─────────────────────────────────────────────────────────────  */

  .content {
    flex: 1;
    overflow-y: auto;
    padding: 0 32px 40px;
  }

  .section {
    max-width: 600px;
    padding-top: 28px;
  }

  .section-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 6px;
  }

  .section-divider {
    height: 1px;
    background: var(--border);
    margin: 20px 0;
  }

  .section-desc {
    font-size: 0.825rem;
    color: var(--text-muted);
    margin: 0 0 24px;
    line-height: 1.55;
  }

  /* ── Provider card ───────────────────────────────────────────────────────  */

  .provider-card {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px 20px;
    margin-bottom: 16px;
  }

  .provider-header {
    margin-bottom: 14px;
  }

  .provider-name {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .provider-status {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--surface-main);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px 7px;
  }
  .provider-status.ok {
    color: #4ade80;
    border-color: #4ade8040;
    background: #4ade8010;
  }

  .provider-notice {
    font-size: 0.8rem;
    color: var(--text-muted);
    background: var(--error-bg);
    border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 14px;
    line-height: 1.5;
  }

  /* ── Fields ──────────────────────────────────────────────────────────────  */

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 18px;
  }
  .field:last-child {
    margin-bottom: 0;
  }

  label {
    font-size: 0.825rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .label-sub {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 0.78rem;
  }

  input[type='text'],
  input[type='password'],
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
  input[type='text']:focus,
  input[type='password']:focus,
  select:focus,
  textarea:focus {
    border-color: var(--accent);
  }
  textarea {
    resize: vertical;
    min-height: 100px;
    line-height: 1.6;
  }

  .key-wrap {
    display: flex;
    gap: 8px;
  }
  .key-wrap input {
    flex: 1;
  }

  .btn-toggle {
    background: var(--surface-main);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0 14px;
    font-size: 0.8rem;
    cursor: pointer;
    color: var(--text-secondary);
    white-space: nowrap;
    transition: all 0.1s;
    flex-shrink: 0;
  }
  .btn-toggle:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.5;
  }

  /* ── Model list ──────────────────────────────────────────────────────────  */

  .model-list-label {
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 8px;
  }

  .model-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .model-row {
    border-radius: 8px;
    transition: background 0.1s;
  }
  .model-row:hover:not(.disabled) {
    background: var(--surface-hover);
  }
  .model-row.disabled {
    opacity: 0.45;
  }

  .model-label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 8px;
    cursor: pointer;
    border-radius: 8px;
  }
  .model-row.disabled .model-label {
    cursor: not-allowed;
  }

  .model-label input[type='checkbox'] {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    accent-color: var(--accent);
    cursor: pointer;
    /* override the global input style */
    background: unset;
    border: unset;
    border-radius: unset;
    padding: unset;
  }

  .model-name {
    font-size: 0.85rem;
    color: var(--text-primary);
    flex: 1;
  }

  .model-meta {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .tag {
    font-size: 0.68rem;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--surface-main);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .tag-reason {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 35%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  /* ── Theme picker ────────────────────────────────────────────────────────  */

  .theme-options {
    display: flex;
    gap: 8px;
  }

  .theme-btn {
    flex: 1;
    background: var(--surface-input);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 0.875rem;
    cursor: pointer;
    color: var(--text-secondary);
    transition: all 0.15s;
    font-family: inherit;
  }
  .theme-btn:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
  .theme-btn.active {
    background: var(--surface-active);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 500;
  }

  /* ── Empty notice ────────────────────────────────────────────────────────  */

  .empty-notice {
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 20px 24px;
    font-size: 0.875rem;
    color: var(--text-muted);
    text-align: center;
  }

  /* ── Mobile ──────────────────────────────────────────────────────────────  */

  @media (max-width: 639px) {
    .topbar {
      padding: 0 16px;
    }

    .sidebar {
      display: none;
    }

    .tab-bar {
      display: flex;
      overflow-x: auto;
      flex-shrink: 0;
      border-bottom: 1px solid var(--border);
      padding: 0 8px;
      gap: 2px;
      scrollbar-width: none;
    }
    .tab-bar::-webkit-scrollbar {
      display: none;
    }

    .tab {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-shrink: 0;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 10px 12px 12px;
      font-size: 0.82rem;
      color: var(--text-muted);
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .tab:hover {
      color: var(--text-primary);
    }
    .tab.active {
      color: var(--accent);
      border-bottom-color: var(--accent);
    }

    .content {
      padding: 0 16px 40px;
    }

    .section {
      padding-top: 20px;
      /* allow full width on mobile */
      max-width: 100%;
    }

    .provider-card {
      padding: 14px 14px;
    }

    .theme-options {
      flex-wrap: wrap;
    }

    /* Stack API key input + toggle button vertically on mobile */
    .key-wrap {
      flex-direction: column;
    }
    .btn-toggle {
      width: 100%;
      padding: 9px 14px;
    }

    /* Hide context-window tag on mobile, keep reasoning tag */
    .tag:not(.tag-reason) {
      display: none;
    }

    /* Tighten model row layout */
    .model-label {
      padding: 8px 6px;
      gap: 8px;
    }

    .model-name {
      font-size: 0.82rem;
    }
  }

  /* Extra-small screens */
  @media (max-width: 374px) {
    .topbar {
      padding: 0 12px;
    }

    .content {
      padding: 0 12px 40px;
    }

    .tab {
      padding: 10px 8px 12px;
      font-size: 0.78rem;
    }
  }
</style>
