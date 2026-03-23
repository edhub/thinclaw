<script lang="ts">
  import '../app.css'
  import { onMount } from 'svelte'
  import { browser } from '$app/environment'
  import { settings } from '$lib/stores/settings'

  let { children } = $props()

  import { THEMES } from '$lib/themes'

  // Reactively write the chosen theme id to <html data-theme="...">
  // so that :root[data-theme="xxx"] CSS blocks in app.css take effect.
  // Also update <meta name="theme-color"> to match the active accent.
  $effect(() => {
    if (browser) {
      const themeId = $settings.theme || 'ayu-light'
      document.documentElement.dataset.theme = themeId
      const accent = THEMES.find((t) => t.id === themeId)?.accent ?? '#ff9940'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent)
    }
  })

  onMount(async () => {
    // Register service worker via vite-plugin-pwa virtual module.
    // Using dynamic import so it's skipped in SSR/prerender and doesn't
    // block the initial render in the browser.
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({ immediate: true })
  })
</script>

{@render children()}
