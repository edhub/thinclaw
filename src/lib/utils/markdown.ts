/**
 * Markdown renderer with lazy-loaded syntax highlighting via highlight.js.
 *
 * We import 'highlight.js/lib/common' (37 common languages, ~300 KB) instead of
 * the full 'highlight.js' (~970 KB / 192 languages) to keep the lazy chunk small.
 * Covered: js/ts, python, bash/shell, go, rust, java, c/cpp, json, yaml, xml/html,
 *           css/scss, markdown, sql, swift, kotlin, ruby, php, diff, …
 */
import { marked } from 'marked'

// highlight.js/lib/common re-exports the same HLJSApi as the default package.
type HljsModule = typeof import('highlight.js').default
let hljsPromise: Promise<HljsModule> | null = null

function getHljs(): Promise<HljsModule> {
  if (!hljsPromise) {
    hljsPromise = import('highlight.js/lib/common').then((m) => m.default as HljsModule)
  }
  return hljsPromise
}

// Renderer that highlights code blocks once hljs is loaded
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  // Synchronous path: if hljs not loaded yet, render plain (will be replaced on next render)
  return `<pre><code class="language-${lang ?? ''}" data-raw="${encodeURIComponent(text)}">${escapeHtml(text)}</code></pre>`
}

marked.use({ renderer, breaks: true })

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Render markdown to HTML string. Code blocks are highlighted if hljs is available. */
export async function renderMarkdown(content: string): Promise<string> {
  const hljs = await getHljs()

  // Override renderer with live hljs instance
  const liveRenderer = new marked.Renderer()
  liveRenderer.code = ({ text, lang }) => {
    const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
    const highlighted = hljs.highlight(text, { language }).value
    return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`
  }

  const result = await marked.parse(content, { renderer: liveRenderer })
  return typeof result === 'string' ? result : ''
}
