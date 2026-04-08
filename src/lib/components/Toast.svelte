<script lang="ts">
  import { toast } from '$lib/stores/toast'
  import { fly } from 'svelte/transition'
  import { CheckCircle, AlertCircle, Info } from 'lucide-svelte'
</script>

<!-- Portal: fixed bottom-center, above everything -->
<div
  class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]
         flex flex-col items-center gap-2 pointer-events-none"
  aria-live="polite"
  aria-atomic="false"
>
  {#each $toast as item (item.id)}
    <div
      class="flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg
             text-[0.85rem] font-medium pointer-events-auto
             border border-line bg-surface-elevated text-fg
             max-w-[min(88vw,320px)] whitespace-nowrap"
      in:fly={{ y: 16, duration: 220 }}
      out:fly={{ y: 8, duration: 180 }}
    >
      {#if item.kind === 'success'}
        <CheckCircle size={15} class="text-success shrink-0" />
      {:else if item.kind === 'error'}
        <AlertCircle size={15} class="text-error shrink-0" />
      {:else}
        <Info size={15} class="text-accent shrink-0" />
      {/if}
      <span>{item.message}</span>
    </div>
  {/each}
</div>
