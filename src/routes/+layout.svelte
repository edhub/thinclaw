<script lang="ts">
  import '../app.css'
  import { onMount } from 'svelte'

  let { children } = $props()

  onMount(async () => {
    // Register service worker via vite-plugin-pwa virtual module.
    // Using dynamic import so it's skipped in SSR/prerender and doesn't
    // block the initial render in the browser.
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  })
</script>

{@render children()}
