<!--
  Settings page — full-page replacement for the modal.

  Sections (left sidebar / top tabs on mobile):
    供应商    API keys + per-provider model toggles
    外观      Custom system prompt + call delay
    灵魂      Soul editor (reuses SettingsSoul.svelte)
    记忆      Memory list (reuses SettingsMemory.svelte)
-->
<script lang="ts">
  import { X, Eye, EyeOff } from 'lucide-svelte'
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
    IMAGE_MODELS,
    DEFAULT_IMAGE_MODEL_KEY,
  } from '$lib/stores/settings'
  import { THEMES } from '$lib/themes'
  import SettingsSoul from '$lib/components/SettingsSoul.svelte'
  import SettingsMemory from '$lib/components/SettingsMemory.svelte'

  type Section = 'providers' | 'appearance' | 'soul' | 'memory'
  let activeSection = $state<Section>('providers')

  const NAV: { id: Section; label: string }[] = [
    { id: 'providers', label: '模型 & 供应商' },
    { id: 'appearance', label: '外观 & 指令' },
    { id: 'soul', label: '灵魂' },
    { id: 'memory', label: '记忆' },
  ]

  const memCount = $derived($memories.length)

  let laozhangKey = $state($settings.laozhangApiKey)
  let showLaozhang = $state(false)
  $effect(() => {
    laozhangKey = $settings.laozhangApiKey
  })
  function saveLaozhangKey() {
    updateSettings({ laozhangApiKey: laozhangKey })
  }

  let bianxieKey = $state($settings.bianxieApiKey)
  let showBianxie = $state(false)
  $effect(() => {
    bianxieKey = $settings.bianxieApiKey
  })
  function saveBianxieKey() {
    updateSettings({ bianxieApiKey: bianxieKey })
  }

  let lingyaaiKey = $state($settings.lingyaaiApiKey)
  let showLingyaai = $state(false)
  $effect(() => {
    lingyaaiKey = $settings.lingyaaiApiKey
  })
  function saveLingyaaiKey() {
    updateSettings({ lingyaaiApiKey: lingyaaiKey })
  }

  let qiniuKey = $state($settings.qiniuApiKey)
  let showQiniu = $state(false)
  $effect(() => {
    qiniuKey = $settings.qiniuApiKey
  })
  function saveQiniuKey() {
    updateSettings({ qiniuApiKey: qiniuKey })
  }

  const laozhangModels = $derived(MODELS.filter((m) => m.provider === 'laozhang'))
  const bianxieModels = $derived(MODELS.filter((m) => m.provider === 'bianxie'))
  const lingyaaiModels = $derived(MODELS.filter((m) => m.provider === 'lingyaai'))
  const qiniuModels = $derived(MODELS.filter((m) => m.provider === 'qiniu'))

  function toggleModel(key: string): void {
    const s = $settings
    const keyed = getKeyedModels(s).map(modelKey)
    const effective = s.enabledModelKeys.length === 0 ? keyed : s.enabledModelKeys
    let next = effective.includes(key) ? effective.filter((k) => k !== key) : [...effective, key]
    const allEnabled = keyed.every((k) => next.includes(k))
    updateSettings({ enabledModelKeys: allEnabled ? [] : next })
  }

  const availableModels = $derived(getAvailableModels($settings))

  let systemPromptDraft = $state($settings.systemPrompt)
  function saveSystemPrompt() {
    updateSettings({ systemPrompt: systemPromptDraft })
  }

  onMount(() => {
    document.title = 'Settings — ThinClaw'
  })
</script>

<!-- ── Page shell ──────────────────────────────────────────────────────── -->
<div class="flex flex-col h-screen bg-surface text-fg font-[inherit]">
  <!-- Top bar -->
  <header
    class="flex items-center gap-3 px-6 h-[52px] border-b border-line flex-shrink-0
                 max-sm:px-4"
  >
    <h1 class="text-[0.9rem] font-semibold text-fg m-0 flex-1">设置</h1>
    <button
      class="flex items-center justify-center w-7 h-7 rounded-lg text-fg-muted bg-transparent
             border-none cursor-pointer p-0 transition-all duration-100 flex-shrink-0
             hover:bg-surface-hover hover:text-fg"
      onclick={closeSettings}
      type="button"
      aria-label="关闭设置"
    >
      <X size={16} />
    </button>
  </header>

  <!-- Mobile tab bar (hidden on sm+) -->
  <div
    class="hidden max-sm:flex overflow-x-auto flex-shrink-0 border-b border-line
              px-2 gap-0.5 no-scrollbar"
    role="tablist"
  >
    {#each NAV as item (item.id)}
      <button
        class="flex items-center gap-1.5 flex-shrink-0 bg-transparent border-none
               border-b-2 border-transparent px-3 pb-3 pt-2.5 text-[0.82rem] text-fg-muted
               cursor-pointer font-[inherit] transition-all duration-150 whitespace-nowrap
               hover:text-fg"
        class:tab-active={activeSection === item.id}
        onclick={() => (activeSection = item.id)}
        role="tab"
        aria-selected={activeSection === item.id}
        type="button"
      >
        {item.label}
        {#if item.id === 'memory' && memCount > 0}
          <span
            class="bg-accent text-white rounded-full text-[0.68rem] font-semibold
                       px-[5px] py-px leading-[1.4]">{memCount}</span
          >
        {/if}
      </button>
    {/each}
  </div>

  <!-- Body -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Sidebar nav (hidden on mobile) -->
    <nav
      class="hidden sm:flex w-[180px] flex-shrink-0 py-4 px-2.5 border-r border-line
                flex-col gap-0.5 overflow-y-auto"
      aria-label="设置导航"
    >
      {#each NAV as item (item.id)}
        <button
          class="flex items-center justify-between gap-1.5 w-full bg-transparent border-none
                 rounded-lg px-3 py-2 text-sm text-fg-sub cursor-pointer text-left
                 transition-all duration-100 hover:bg-surface-hover hover:text-fg"
          class:nav-active={activeSection === item.id}
          onclick={() => (activeSection = item.id)}
          type="button"
        >
          {item.label}
          {#if item.id === 'memory' && memCount > 0}
            <span
              class="bg-accent text-white rounded-full text-[0.68rem] font-semibold
                         px-[5px] py-px leading-[1.4]">{memCount}</span
            >
          {/if}
        </button>
      {/each}
    </nav>

    <!-- Content area -->
    <main class="flex-1 overflow-y-auto px-8 pb-10 max-sm:px-4">
      <!-- ── 模型 & 供应商 ───────────────────────────────────────────── -->
      {#if activeSection === 'providers'}
        <div class="max-w-[600px] pt-7">
          <h2 class="text-base font-semibold text-fg m-0 mb-1.5">模型 & 供应商</h2>
          <p class="text-[0.825rem] text-fg-muted m-0 mb-6 leading-[1.55]">
            选择默认对话模型和工具模型，配置各供应商密钥并选择要启用的模型。
          </p>

          {#if availableModels.length === 0}
            <div
              class="bg-surface-elevated border border-line rounded-xl px-6 py-5
                        text-sm text-fg-muted text-center"
            >
              没有可用模型。请先在下方配置 API 密钥。
            </div>
          {:else}
            {@render field('默认对话模型', '新建对话时默认使用的模型。')}
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <div class="flex flex-col gap-1.5 mb-[18px]">
              <label class="text-[0.825rem] font-medium text-fg-sub" for="default-model">
                默认对话模型
              </label>
              <select
                id="default-model"
                class="settings-input"
                value={$settings.model}
                onchange={(e) => updateSettings({ model: (e.target as HTMLSelectElement).value })}
              >
                {#each availableModels as m (modelKey(m))}
                  <option value={modelKey(m)}>{m.name}</option>
                {/each}
              </select>
              <p class="text-[0.75rem] text-fg-muted m-0 leading-[1.5]">
                新建对话时默认使用的模型。
              </p>
            </div>
            <div class="flex flex-col gap-1.5 mb-[18px]">
              <label class="text-[0.825rem] font-medium text-fg-sub" for="utility-model">
                工具模型
              </label>
              <select
                id="utility-model"
                class="settings-input"
                value={$settings.utilityModelKey}
                onchange={(e) =>
                  updateSettings({ utilityModelKey: (e.target as HTMLSelectElement).value })}
              >
                {#each availableModels as m (modelKey(m))}
                  <option value={modelKey(m)}>{m.name}</option>
                {/each}
              </select>
              <p class="text-[0.75rem] text-fg-muted m-0 leading-[1.5]">
                用于对话摘要和自动标题生成，推荐选速度快、成本低的模型。
              </p>
            </div>
            <div class="flex flex-col gap-1.5 mb-[18px]">
              <label class="text-[0.825rem] font-medium text-fg-sub" for="image-model">
                图像工具模型
              </label>
              <select
                id="image-model"
                class="settings-input"
                value={$settings.imageGenerationModel ?? DEFAULT_IMAGE_MODEL_KEY}
                onchange={(e) =>
                  updateSettings({
                    imageGenerationModel: (e.target as HTMLSelectElement).value,
                  })}
              >
                {#each IMAGE_MODELS as m (m.key)}
                  <option value={m.key}>{m.name}</option>
                {/each}
              </select>
              <p class="text-[0.75rem] text-fg-muted m-0 leading-[1.5]">
                用于 <span class="font-mono text-fg-sub">generate_image</span> 和
                <span class="font-mono text-fg-sub">edit_image</span> 工具。需确保对应供应商已配置
                API 密钥。
              </p>
            </div>
          {/if}

          <div class="h-px bg-line my-5"></div>

          {@render providerCard(
            'laozhang',
            '老张 · laozhang.ai',
            $settings.laozhangApiKey,
            '⚠ 未配置密钥，该供应商下的模型和图像生成功能不可用。',
            'laozhang-key',
            showLaozhang,
            laozhangKey,
            () => (showLaozhang = !showLaozhang),
            (v) => (laozhangKey = v),
            saveLaozhangKey,
            'api.laozhang.ai',
            laozhangModels,
          )}
          <div class="h-px bg-line my-5"></div>
          {@render providerCard(
            'bianxie',
            '便携 · bianxie.ai',
            $settings.bianxieApiKey,
            '⚠ 未配置密钥，该供应商下的模型不可用。',
            'bianxie-key',
            showBianxie,
            bianxieKey,
            () => (showBianxie = !showBianxie),
            (v) => (bianxieKey = v),
            saveBianxieKey,
            'api.bianxie.ai',
            bianxieModels,
          )}
          <div class="h-px bg-line my-5"></div>
          {@render providerCard(
            'lingyaai',
            '灵芽 · lingyaai.cn',
            $settings.lingyaaiApiKey,
            '⚠ 未配置密钥，该供应商下的模型不可用。',
            'lingyaai-key',
            showLingyaai,
            lingyaaiKey,
            () => (showLingyaai = !showLingyaai),
            (v) => (lingyaaiKey = v),
            saveLingyaaiKey,
            'api.lingyaai.cn',
            lingyaaiModels,
          )}
          <div class="h-px bg-line my-5"></div>
          {@render providerCard(
            'qiniu',
            '七牛 · qnaigc.com',
            $settings.qiniuApiKey,
            '⚠ 未配置密钥，该供应商下的模型不可用。',
            'qiniu-key',
            showQiniu,
            qiniuKey,
            () => (showQiniu = !showQiniu),
            (v) => (qiniuKey = v),
            saveQiniuKey,
            'api.qnaigc.com',
            qiniuModels,
          )}
        </div>

        <!-- ── 外观 & 指令 ──────────────────────────────────────────────── -->
      {:else if activeSection === 'appearance'}
        <div class="max-w-[600px] pt-7 max-sm:max-w-full max-sm:pt-5">
          <h2 class="text-base font-semibold text-fg m-0 mb-1.5">外观 & 指令</h2>

          <!-- Theme picker -->
          <div class="flex flex-col gap-1.5 mb-[22px]">
            <!-- svelte-ignore a11y_label_has_associated_control -->
            <label class="text-[0.825rem] font-medium text-fg-sub">配色主题</label>
            <div class="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
              {#each THEMES as theme (theme.id)}
                {@const active = ($settings.theme || 'ayu-light') === theme.id}
                <button
                  type="button"
                  class="theme-swatch"
                  class:theme-swatch-active={active}
                  onclick={() => updateSettings({ theme: theme.id })}
                  style="--swatch-bg:{theme.bg}; --swatch-accent:{theme.accent}; --swatch-text:{theme.text}"
                  title={theme.label}
                >
                  <!-- Mini preview strip -->
                  <span class="swatch-preview" aria-hidden="true">
                    <span class="swatch-bar" style="background:{theme.bg}">
                      <span class="swatch-dot" style="background:{theme.accent}"></span>
                      <span class="swatch-line" style="background:{theme.text}"></span>
                      <span
                        class="swatch-line swatch-line-short"
                        style="background:{theme.text}"
                      ></span>
                    </span>
                  </span>
                  <span class="swatch-label" style="color:{active ? theme.accent : ''}"
                    >{theme.label}</span
                  >
                  {#if active}
                    <span class="swatch-check" style="color:{theme.accent}">✓</span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>

          <div class="h-px bg-line my-5"></div>

          <div class="flex flex-col gap-1.5 mb-[18px]">
            <label class="text-[0.825rem] font-medium text-fg-sub" for="system-prompt">
              自定义指令
              <span class="font-normal text-fg-muted text-[0.78rem]">（附加到灵魂之后）</span>
            </label>
            <textarea
              id="system-prompt"
              class="settings-input resize-y min-h-[100px] leading-[1.6]"
              bind:value={systemPromptDraft}
              rows="6"
              placeholder="可选：为 AI 添加额外的行为说明或约束…"
              onblur={saveSystemPrompt}
            ></textarea>
            <p class="text-[0.75rem] text-fg-muted m-0 leading-[1.5]">离开输入框时自动保存。</p>
          </div>

          <div class="h-px bg-line my-5"></div>

          <div class="flex flex-col gap-1.5 mb-[18px]">
            <label class="text-[0.825rem] font-medium text-fg-sub" for="tool-call-delay">
              API 调用最小间隔
              <span class="font-normal text-fg-muted text-[0.78rem]">（防止触发 Rate Limit）</span>
            </label>
            <div class="flex items-center gap-3">
              <input
                id="tool-call-delay"
                type="range"
                min="3"
                max="10"
                step="1"
                class="flex-1 accent-[var(--accent)] cursor-pointer"
                value={$settings.toolCallDelay ?? 4}
                oninput={(e) =>
                  updateSettings({ toolCallDelay: Number((e.target as HTMLInputElement).value) })}
              />
              <span class="text-[0.85rem] font-semibold text-fg min-w-[36px] text-right">
                {$settings.toolCallDelay ?? 4} 秒
              </span>
            </div>
            <p class="text-[0.75rem] text-fg-muted m-0 leading-[1.5]">
              Agent 在 Tool Call 循环中连续调用 API
              时，每次调用之间强制等待该时长。首次用户消息不受影响。范围：3–10 秒。
            </p>
          </div>
        </div>

        <!-- ── 灵魂 ──────────────────────────────────────────────────────── -->
      {:else if activeSection === 'soul'}
        <div class="max-w-[600px] pt-7 max-sm:max-w-full max-sm:pt-5">
          <h2 class="text-base font-semibold text-fg m-0 mb-1.5">灵魂</h2>
          <SettingsSoul />
        </div>

        <!-- ── 记忆 ──────────────────────────────────────────────────────── -->
      {:else if activeSection === 'memory'}
        <div class="max-w-[600px] pt-7 max-sm:max-w-full max-sm:pt-5">
          <h2 class="text-base font-semibold text-fg m-0 mb-1.5">记忆</h2>
          <SettingsMemory />
        </div>
      {/if}
    </main>
  </div>
</div>

<!-- ── Snippets ─────────────────────────────────────────────────────────── -->

{#snippet field(label: string, hint: string)}
  <!-- placeholder — field content rendered inline above -->
{/snippet}

{#snippet providerCard(
  _id: string,
  name: string,
  apiKey: string,
  noticeText: string,
  inputId: string,
  showKey: boolean,
  keyValue: string,
  onToggleShow: () => void,
  onKeyInput: (v: string) => void,
  onKeyBlur: () => void,
  apiDomain: string,
  models: any[],
)}
  <div
    class="bg-surface-elevated border border-line rounded-xl p-[18px_20px] mb-4
              max-sm:p-[14px]"
  >
    <!-- Provider header -->
    <div class="mb-3.5">
      <div class="text-[0.9rem] font-semibold text-fg flex items-center gap-2.5">
        {name}
        <span
          class="text-[0.72rem] font-medium border rounded-md px-[7px] py-0.5 transition-colors"
          class:status-ok={!!apiKey}
          class:status-none={!apiKey}
        >
          {apiKey ? '✓ 已配置' : '未配置'}
        </span>
      </div>
    </div>

    {#if !apiKey}
      <div
        class="text-[0.8rem] text-fg-muted bg-error-bg border
                  border-[color-mix(in_srgb,var(--error)_30%,transparent)]
                  rounded-lg px-3 py-2 mb-3.5 leading-[1.5]"
      >
        {noticeText}
      </div>
    {/if}

    <!-- Key field -->
    <div class="flex flex-col gap-1.5 mb-[18px]">
      <label class="text-[0.825rem] font-medium text-fg-sub" for={inputId}>API 密钥</label>
      <div class="flex gap-2 max-sm:flex-col">
        <input
          id={inputId}
          type={showKey ? 'text' : 'password'}
          class="settings-input flex-1"
          value={keyValue}
          placeholder="sk-..."
          autocomplete="off"
          spellcheck="false"
          oninput={(e) => onKeyInput((e.target as HTMLInputElement).value)}
          onblur={onKeyBlur}
        />
        <button
          class="bg-surface border border-line rounded-lg px-3 min-w-[40px] text-[0.8rem]
                 cursor-pointer text-fg-sub whitespace-nowrap transition-all duration-100
                 flex-shrink-0 flex items-center justify-center
                 hover:bg-surface-hover hover:text-fg max-sm:w-full max-sm:py-2.5"
          type="button"
          onclick={onToggleShow}
          title={showKey ? '隐藏' : '显示'}
        >
          {#if showKey}<EyeOff size={15} />{:else}<Eye size={15} />{/if}
        </button>
      </div>
      <p class="text-[0.75rem] text-fg-muted m-0 leading-[1.5]">
        密钥仅存储在您的浏览器本地，直接发送至 {apiDomain}。
      </p>
    </div>

    <!-- Model list -->
    <div class="text-[0.78rem] font-medium text-fg-muted uppercase tracking-[0.05em] mb-2">
      模型
    </div>
    <ul class="list-none m-0 p-0 flex flex-col gap-1">
      {#each models as m (modelKey(m))}
        {@const enabled = isModelEnabled(m, $settings)}
        {@const hasKey = !!apiKey}
        <li
          class="rounded-lg transition-colors duration-100"
          class:opacity-45={!hasKey}
          class:hover-bg={hasKey}
        >
          <label
            class="flex items-center gap-2.5 px-2 py-[7px] rounded-lg
                   max-sm:gap-2 max-sm:px-1.5"
            class:cursor-pointer={hasKey}
            class:cursor-not-allowed={!hasKey}
          >
            <input
              type="checkbox"
              class="model-checkbox"
              checked={enabled}
              disabled={!hasKey}
              onchange={() => toggleModel(modelKey(m))}
            />
            <span class="text-[0.85rem] text-fg flex-1 max-sm:text-[0.82rem]">{m.name}</span>
            <span class="flex gap-1 flex-shrink-0">
              {#if m.reasoning}
                <span
                  class="text-[0.68rem] px-1.5 py-0.5 rounded-[5px] tabular-nums whitespace-nowrap
                             text-accent border
                             border-[color-mix(in_srgb,var(--accent)_35%,transparent)]
                             bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                >
                  reasoning
                </span>
              {/if}
              <span
                class="text-[0.68rem] px-1.5 py-0.5 rounded-[5px] bg-surface border
                           border-line text-fg-muted tabular-nums whitespace-nowrap
                           max-sm:hidden"
              >
                {(m.contextWindow / 1000).toFixed(0)}K ctx
              </span>
            </span>
          </label>
        </li>
      {/each}
    </ul>
  </div>
{/snippet}

<style>
  /* ── Theme swatch picker ── */
  .theme-swatch {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--surface-elevated);
    border: 1.5px solid var(--border);
    border-radius: 10px;
    padding: 10px 10px 8px;
    cursor: pointer;
    font-family: inherit;
    transition:
      border-color 0.15s,
      background 0.15s;
    text-align: left;
  }
  .theme-swatch:hover {
    background: var(--surface-hover);
    border-color: var(--text-muted);
  }
  .theme-swatch-active {
    border-color: var(--swatch-accent);
    background: var(--surface-hover);
  }
  .swatch-preview {
    display: block;
  }
  .swatch-bar {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 7px;
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.07);
  }
  .swatch-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .swatch-line {
    height: 3px;
    border-radius: 2px;
    flex: 1;
    opacity: 0.35;
  }
  .swatch-line-short {
    flex: 0.5;
  }
  .swatch-label {
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text-secondary);
    line-height: 1.3;
    transition: color 0.15s;
  }
  .swatch-check {
    position: absolute;
    top: 7px;
    right: 9px;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
  }

  /* Shared form input style — used by many inputs/selects/textareas */
  .settings-input {
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
  .settings-input:focus {
    border-color: var(--accent);
  }

  /* Checkbox — override the global .settings-input rule */
  .model-checkbox {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    accent-color: var(--accent);
    cursor: pointer;
    background: unset;
    border: unset;
    border-radius: unset;
    padding: unset;
  }

  /* Nav active state */
  .nav-active {
    background: var(--surface-active);
    color: var(--accent);
    font-weight: 500;
  }

  /* Mobile tab active state */
  .tab-active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  /* Provider status badge variants */
  .status-ok {
    color: #4ade80;
    border-color: #4ade8040;
    background: #4ade8010;
  }
  .status-none {
    color: var(--text-muted);
    border-color: var(--border);
    background: var(--surface-main);
  }

  /* Model row hover (only when not disabled) */
  .hover-bg:hover {
    background: var(--surface-hover);
  }

  /* Mobile: hide scrollbar on tab bar */
  .no-scrollbar {
    scrollbar-width: none;
  }
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }
</style>
