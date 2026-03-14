<!--
  SessionViewer — JSONL data inspector for session files.

  Each entry is rendered as a row: type badge + key-field summary + expandable raw JSON.
  Goal: readable at a glance, full data accessible on demand.
-->
<script lang="ts">
  import type { SessionEntry } from '$lib/fs/session-recorder'

  interface Props {
    entries: SessionEntry[]
  }
  let { entries }: Props = $props()

  // Track which entries are expanded (by index)
  let expanded = $state<Set<number>>(new Set())

  // ── Aggregate token usage across all assistant turns ─────────────────────

  interface UsageTotals {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    turns: number
  }

  const totalUsage = $derived.by<UsageTotals>(() => {
    const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 }
    for (const entry of entries) {
      if (entry.type !== 'message') continue
      const msg = (entry as any).message
      if (msg?.role !== 'assistant' || !msg.usage) continue
      const u = msg.usage
      t.input += u.input ?? 0
      t.output += u.output ?? 0
      t.cacheRead += u.cacheRead ?? 0
      t.cacheWrite += u.cacheWrite ?? 0
      t.turns++
    }
    return t
  })

  function toggle(i: number) {
    const next = new Set(expanded)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    expanded = next
  }

  // ── Type badge config ────────────────────────────────────────────────────

  type BadgeKind = 'session' | 'user' | 'assistant' | 'tool-result' | 'compaction' | 'other'

  function badgeKind(entry: SessionEntry): BadgeKind {
    if (entry.type === 'session') return 'session'
    if (entry.type === 'message') {
      const role = (entry as any).message?.role
      if (role === 'user') return 'user'
      if (role === 'assistant') return 'assistant'
      if (role === 'toolResult') return 'tool-result'
      if (role === 'compactionSummary') return 'compaction'
    }
    return 'other'
  }

  function badgeLabel(entry: SessionEntry): string {
    if (entry.type === 'session') return 'session'
    if (entry.type === 'message') {
      const role = (entry as any).message?.role ?? '?'
      if (role === 'toolResult') return 'tool-result'
      if (role === 'compactionSummary') return 'compaction'
      return role
    }
    return (entry as { type: string }).type
  }

  // ── Summary extraction (one-liner per entry) ──────────────────────────────

  function summarize(entry: SessionEntry): string {
    try {
      if (entry.type === 'session') {
        const h = entry as any
        const spLen = (h.systemPrompt as string | undefined)?.length ?? 0
        const parts = [
          `"${h.conversationTitle}"`,
          h.model,
          `thinking: ${h.thinkingLevel ?? 'off'}`,
          ...(h.personaId ? [`persona: ${h.personaId}`] : []),
          `created ${fmtDate(new Date(h.createdAt).toISOString())}`,
          ...(spLen > 0 ? [`system prompt ${spLen.toLocaleString()} chars`] : []),
        ]
        return parts.join('  ·  ')
      }
      if (entry.type === 'message') {
        const msg = (entry as any).message
        const role: string = msg?.role ?? '?'

        if (role === 'user') {
          return snippet(textOf(msg.content))
        }
        if (role === 'assistant') {
          const texts = (msg.content ?? [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text as string)
          const thinking = (msg.content ?? []).filter((b: any) => b.type === 'thinking')
          const tools = (msg.content ?? []).filter((b: any) => b.type === 'toolCall')
          const parts: string[] = []
          if (thinking.length)
            parts.push(`💭 ${thinking.length} thinking block${thinking.length > 1 ? 's' : ''}`)
          if (tools.length) parts.push(`🔧 ${tools.map((t: any) => t.name).join(', ')}`)
          if (texts.length) parts.push(snippet(texts.join('')))
          if (msg.usage) {
            const u = msg.usage
            const usageParts: string[] = []
            if (u.input > 0 || u.output > 0) {
              usageParts.push(`↑${u.input.toLocaleString()} ↓${u.output.toLocaleString()}`)
            }
            if (u.cacheRead > 0) usageParts.push(`⚡r:${u.cacheRead.toLocaleString()}`)
            if (u.cacheWrite > 0) usageParts.push(`⬡w:${u.cacheWrite.toLocaleString()}`)
            if (usageParts.length) parts.push(`[${usageParts.join(' ')}]`)
          }
          return parts.join('  ·  ') || '(empty)'
        }
        if (role === 'toolResult') {
          const resultText = (msg.content ?? [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text as string)
            .join('')
          const err = msg.isError ? '❌ error  ·  ' : ''
          return `${msg.toolName}  ·  ${err}${snippet(resultText)}`
        }
        if (role === 'compactionSummary') {
          return `~${msg.tokensBefore?.toLocaleString() ?? '?'} tokens → ${snippet(msg.summary ?? '')}`
        }
        return snippet(JSON.stringify(msg))
      }
    } catch {
      // fall through
    }
    return ''
  }

  function textOf(content: unknown): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text as string)
        .join('')
    }
    return ''
  }

  function snippet(s: string, max = 120): string {
    const flat = s.replace(/\s+/g, ' ').trim()
    return flat.length > max ? flat.slice(0, max) + '…' : flat
  }

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  // ── Pretty-print JSON (truncate large base64 blobs) ────────────────────────

  function prettyJson(entry: SessionEntry): string {
    // Deep-clone via JSON round-trip, then truncate any long base64-like strings
    // (e.g. generated image data stored in tool result details).
    return JSON.stringify(entry, (_key, value) => {
      if (typeof value === 'string' && value.length > 200 && /^[A-Za-z0-9+/=]+$/.test(value)) {
        return `[base64 ~${Math.round(value.length / 1024)}KB — truncated]`
      }
      return value
    }, 2)
  }

  /** Extract a generated image from a tool-result entry, if present. */
  function extractGeneratedImage(entry: SessionEntry): { imageData: string; mimeType: string; prompt: string; aspectRatio: string; imageSize: string } | null {
    if (entry.type !== 'message') return null
    const msg = (entry as any).message
    if (msg?.role !== 'toolResult' || msg?.toolName !== 'generate_image') return null
    const d = msg?.details
    if (!d?.imageData) return null
    return d
  }
</script>

<div class="inspector">
  <div class="entry-count">{entries.length} entries</div>

  <!-- Session-wide token usage summary -->
  {#if totalUsage.turns > 0}
    <div class="usage-bar">
      <span class="usage-label">Token 用量</span>
      <span class="usage-stat">↑ {totalUsage.input.toLocaleString()} input</span>
      <span class="usage-sep">·</span>
      <span class="usage-stat">↓ {totalUsage.output.toLocaleString()} output</span>
      {#if totalUsage.cacheRead > 0}
        <span class="usage-sep">·</span>
        <span class="usage-stat usage-cache-hit">⚡ {totalUsage.cacheRead.toLocaleString()} cache read</span>
      {:else}
        <span class="usage-sep">·</span>
        <span class="usage-stat usage-cache-miss">⚡ cache: 0</span>
      {/if}
      {#if totalUsage.cacheWrite > 0}
        <span class="usage-sep">·</span>
        <span class="usage-stat">⬡ {totalUsage.cacheWrite.toLocaleString()} cache write</span>
      {/if}
    </div>
  {/if}

  {#each entries as entry, i (i)}
    {@const kind = badgeKind(entry)}
    {@const label = badgeLabel(entry)}
    {@const summary = summarize(entry)}
    {@const open = expanded.has(i)}

    <div class="entry" class:open>
      <!-- Summary row -->
      <button class="entry-row" onclick={() => toggle(i)} type="button">
        <span class="badge badge-{kind}">{label}</span>
        <span class="summary">{summary}</span>
        <svg
          class="chevron"
          class:open
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      <!-- Expanded view -->
      {#if open}
        {#if entry.type === 'session'}
          <!-- Session header: split metadata + system prompt for readability -->
          {@const h = entry as any}
          <div class="session-expanded">
            <div class="meta-block">
              <pre class="raw-json no-border">{JSON.stringify(
                  {
                    type: h.type,
                    conversationId: h.conversationId,
                    conversationTitle: h.conversationTitle,
                    createdAt: h.createdAt,
                    timestamp: h.timestamp,
                    model: h.model,
                    thinkingLevel: h.thinkingLevel,
                    ...(h.personaId ? { personaId: h.personaId } : {}),
                  },
                  null,
                  2,
                )}</pre>
            </div>
            {#if h.systemPrompt}
              <div class="sysprompt-block">
                <div class="sysprompt-label">systemPrompt</div>
                <pre class="sysprompt-text">{h.systemPrompt}</pre>
              </div>
            {/if}
          </div>
        {:else}
          {@const img = extractGeneratedImage(entry)}
          {#if img}
            <div class="generated-image-block">
              <img
                src="data:{img.mimeType};base64,{img.imageData}"
                alt={img.prompt}
                class="session-generated-image"
              />
              <div class="session-image-footer">
                <span class="session-image-meta">{img.aspectRatio} · {img.imageSize}</span>
                <a
                  href="data:{img.mimeType};base64,{img.imageData}"
                  download="generated-{(entry as any).message?.timestamp ?? Date.now()}.{img.mimeType.split('/')[1] ?? 'png'}"
                  class="session-download-link"
                >↓ 保存图片</a>
              </div>
            </div>
          {/if}
          <pre class="raw-json">{prettyJson(entry)}</pre>
        {/if}
      {/if}
    </div>
  {/each}

  {#if entries.length === 0}
    <div class="empty">No entries found.</div>
  {/if}
</div>

<style>
  .inspector {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-count {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    padding: 0 4px 6px;
    flex-shrink: 0;
  }

  /* ── Usage summary bar ── */
  .usage-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    margin-bottom: 6px;
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.72rem;
    flex-shrink: 0;
  }

  .usage-label {
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.68rem;
    margin-right: 2px;
  }

  .usage-stat {
    color: var(--text-secondary);
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.72rem;
  }

  .usage-cache-hit {
    color: var(--accent);
  }

  .usage-cache-miss {
    color: var(--text-muted);
    opacity: 0.7;
  }

  .usage-sep {
    color: var(--border);
    font-size: 0.7rem;
  }

  /* ── Entry card ── */
  .entry {
    border: 1px solid transparent;
    border-radius: 6px;
    transition: border-color 0.1s;
  }

  .entry.open {
    border-color: var(--border);
    background: var(--surface-elevated);
  }

  .entry-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 6px;
    text-align: left;
    transition: background 0.08s;
  }

  .entry-row:hover {
    background: var(--surface-hover);
  }

  .entry.open .entry-row {
    border-radius: 6px 6px 0 0;
  }

  /* ── Type badge ── */
  .badge {
    font-size: 0.68rem;
    font-weight: 700;
    font-family: monospace;
    letter-spacing: 0.03em;
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
    text-transform: lowercase;
  }

  .badge-session {
    background: var(--badge-session-bg);
    color: var(--badge-session-fg);
  }
  .badge-user {
    background: var(--badge-user-bg);
    color: var(--badge-user-fg);
  }
  .badge-assistant {
    background: var(--badge-assistant-bg);
    color: var(--badge-assistant-fg);
  }
  .badge-tool-result {
    background: var(--badge-tool-bg);
    color: var(--badge-tool-fg);
  }
  .badge-compaction {
    background: var(--badge-compaction-bg);
    color: var(--badge-compaction-fg);
  }
  .badge-other {
    background: var(--surface-elevated);
    color: var(--text-muted);
  }

  /* ── Summary text ── */
  .summary {
    flex: 1;
    font-size: 0.82rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.4;
  }

  /* ── Chevron ── */
  .chevron {
    flex-shrink: 0;
    color: var(--text-muted);
    transition: transform 0.15s;
    transform: rotate(0deg);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  /* ── Raw JSON ── */
  .raw-json {
    margin: 0;
    padding: 10px 14px 12px;
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.78rem;
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
    overflow-x: auto;
    border-top: 1px solid var(--border);
    border-radius: 0 0 6px 6px;
  }

  .raw-json.no-border {
    border-top: none;
    border-radius: 0;
    padding-bottom: 4px;
  }

  /* ── Session header expanded layout ── */
  .session-expanded {
    border-top: 1px solid var(--border);
    border-radius: 0 0 6px 6px;
    overflow: hidden;
  }

  .meta-block {
    border-bottom: 1px solid var(--border);
  }

  .sysprompt-block {
    display: flex;
    flex-direction: column;
  }

  .sysprompt-label {
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.72rem;
    color: var(--text-muted);
    padding: 6px 14px 2px;
    letter-spacing: 0.03em;
  }

  .sysprompt-label::before {
    content: '"';
  }

  .sysprompt-label::after {
    content: '":';
  }

  .sysprompt-text {
    margin: 0;
    padding: 4px 14px 14px 20px;
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.78rem;
    line-height: 1.65;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    border-left: 2px solid var(--border);
    margin-left: 14px;
  }

  /* ── Generated image in session ── */
  .generated-image-block {
    border-top: 1px solid var(--border);
    padding: 10px 14px;
  }

  .session-generated-image {
    display: block;
    max-width: 100%;
    border-radius: 6px;
    border: 1px solid var(--border);
  }

  .session-image-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 6px;
  }

  .session-image-meta {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-family: monospace;
  }

  .session-download-link {
    font-size: 0.75rem;
    color: var(--accent);
    text-decoration: none;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.1s;
  }
  .session-download-link:hover {
    background: var(--surface-active);
  }

  /* ── Empty ── */
  .empty {
    color: var(--text-muted);
    font-size: 0.875rem;
    text-align: center;
    padding: 40px 0;
  }
</style>
