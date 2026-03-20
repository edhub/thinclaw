<script lang="ts">
  import { Check, RotateCcw } from 'lucide-svelte'
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

<p class="text-[0.825rem] text-fg-muted mb-3.5 leading-[1.5]">
  这是 AI 的身份设定——包括其价值观、个性和行为准则。AI 可以通过
  <code
    class="bg-surface-elevated border border-line rounded px-1.5 py-px text-[0.8rem] text-fg-sub"
  >
    soul_update
  </code>
  工具自主更新，您也可以直接在此编辑。
</p>

<textarea
  class="block w-full bg-surface-input border border-line rounded-lg px-3 py-2.5
         font-mono text-[0.82rem] leading-[1.6] text-fg resize-y min-h-[320px]
         outline-none box-border transition-colors duration-150 mb-3
         focus:border-accent"
  bind:value={draft}
  spellcheck="false"
  rows="18"
></textarea>

<div class="flex justify-between items-center">
  <button
    class="flex items-center gap-1.5 bg-transparent border border-line rounded-lg px-3.5 py-1.5
           text-[0.85rem] cursor-pointer text-fg-muted transition-all duration-100
           hover:text-error hover:border-error"
    onclick={reset}
    type="button"
  >
    <RotateCcw size={13} />
    恢复默认
  </button>
  <button
    class="flex items-center gap-1.5 bg-accent border-none rounded-lg px-5 py-1.5 text-[0.875rem]
           cursor-pointer text-white font-medium transition-opacity duration-100
           hover:opacity-85"
    onclick={save}
    type="button"
  >
    {#if saved}
      <Check size={14} /> 已保存
    {:else}
      保存灵魂
    {/if}
  </button>
</div>

<style>
  @media (max-width: 639px) {
    textarea {
      min-height: 180px;
    }
  }
</style>
