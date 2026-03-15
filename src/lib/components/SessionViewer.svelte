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
    if (entry.type === 'payload') return 'other'
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
    if (entry.type === 'payload') return 'payload'
    if (entry.type === 'message') {
      const role = (entry as any).message?.role ?? '?'
      if (role === 'toolResult') return 'tool-result'
      if (role === 'compactionSummary') return 'compaction'
      return role
    }
    return (entry as { type: string }).type
  }

  // ── Two-line layout helpers ───────────────────────────────────────────────

  /**
   * First line: role badge + timestamp + token usage (for assistant).
   * Returns empty string if no meaningful metadata.
   */
  function entryMeta(entry: SessionEntry): string {
    const parts: string[] = []
    if (entry.type === 'message') {
      const msg = (entry as any).message
      const ts: number | undefined = msg?.timestamp
      if (ts) parts.push(fmtDate(new Date(ts).toISOString()))
      if (msg?.role === 'assistant' && msg.usage) {
        const u = msg.usage
        const tp: string[] = []
        if (u.input > 0 || u.output > 0)
          tp.push(`↑${u.input.toLocaleString()} ↓${u.output.toLocaleString()}`)
        if (u.cacheRead > 0) tp.push(`⚡${u.cacheRead.toLocaleString()}`)
        if (u.cacheWrite > 0) tp.push(`⬡${u.cacheWrite.toLocaleString()}`)
        if (tp.length) parts.push(tp.join(' '))
      }
    } else if (entry.type === 'session') {
      const h = entry as any
      if (h.timestamp) parts.push(fmtDate(h.timestamp))
    } else if (entry.type === 'payload') {
      const p = entry as any
      if (p.timestamp) parts.push(fmtDate(new Date(p.timestamp).toISOString()))
      const params = p.params ?? {}
      const msgCount = Array.isArray(params.messages) ? params.messages.length : '?'
      parts.push(`${msgCount} messages`)
      if (params.model) parts.push(params.model)
    }
    return parts.join('  ·  ')
  }

  /**
   * Second line: message content only (no token/time info).
   */
  function entryContent(entry: SessionEntry): string {
    try {
      if (entry.type === 'session') {
        const h = entry as any
        const parts = [
          `"${h.conversationTitle}"`,
          h.model,
          `thinking: ${h.thinkingLevel ?? 'off'}`,
          ...(h.personaId ? [`persona: ${h.personaId}`] : []),
        ]
        return parts.join('  ·  ')
      }
      if (entry.type === 'payload') {
        const params = (entry as any).params ?? {}
        const parts: string[] = []
        if (params.system) {
          const sysLen = JSON.stringify(params.system).length
          parts.push(`sys:${sysLen}c`)
        }
        if (Array.isArray(params.tools)) parts.push(`tools:${params.tools.length}`)
        if (params.thinking) parts.push(`thinking:${JSON.stringify(params.thinking)}`)
        parts.push(`max_tokens:${params.max_tokens ?? '?'}`)
        // Show cache_control placement summary
        const ccPositions: string[] = []
        if (params.system?.[params.system.length - 1]?.cache_control) ccPositions.push('sys')
        if (Array.isArray(params.tools) && params.tools[params.tools.length - 1]?.cache_control) ccPositions.push('tools[-1]')
        if (Array.isArray(params.messages)) {
          params.messages.forEach((m: any, i: number) => {
            const hasCC = Array.isArray(m.content) && m.content.some((b: any) => b.cache_control)
            if (hasCC) ccPositions.push(`msg[${i}]:${m.role}`)
          })
        }
        if (ccPositions.length) parts.push(`cc:[${ccPositions.join(',')}]`)
        return parts.join('  ·  ')
      }
      if (entry.type === 'message') {
        const msg = (entry as any).message
        const role: string = msg?.role ?? '?'
        if (role === 'user') return snippet(textOf(msg.content))
        if (role === 'assistant') {
          const texts = (msg.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text as string)
          const thinking = (msg.content ?? []).filter((b: any) => b.type === 'thinking')
          const tools = (msg.content ?? []).filter((b: any) => b.type === 'toolCall')
          const parts: string[] = []
          if (thinking.length) parts.push(`💭 ${thinking.length} thinking block${thinking.length > 1 ? 's' : ''}`)
          if (tools.length) parts.push(`🔧 ${tools.map((t: any) => t.name).join(', ')}`)
          if (texts.length) parts.push(snippet(texts.join('')))
          return parts.join('  ·  ') || '(empty)'
        }
        if (role === 'toolResult') {
          const resultText = (msg.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text as string).join('')
          const err = msg.isError ? '❌  ' : ''
          return `${msg.toolName}  ·  ${err}${snippet(resultText)}`
        }
        if (role === 'compactionSummary') {
          return `~${msg.tokensBefore?.toLocaleString() ?? '?'} tokens → ${snippet(msg.summary ?? '')}`
        }
        return snippet(JSON.stringify(msg))
      }
    } catch { /* fall through */ }
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
    {@const meta = entryMeta(entry)}
    {@const content = entryContent(entry)}
    {@const open = expanded.has(i)}

    <div class="entry" class:open>
      <!-- Summary row -->
      <button class="entry-row" onclick={() => toggle(i)} type="button">
        <div class="entry-main">
          <div class="entry-header-line">
            <span class="badge badge-{kind}">{label}</span>
            {#if meta}<span class="entry-meta">{meta}</span>{/if}
          </div>
          {#if content}<span class="entry-content">{content}</span>{/if}
        </div>
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
            {#if h.tools && h.tools.length > 0}
              <div class="tools-block">
                <div class="tools-header">tools ({h.tools.length})</div>
                {#each h.tools as tool}
                  <div class="tool-item">
                    <div class="tool-name">{tool.name}</div>
                    <div class="tool-desc">{tool.description}</div>
                    <pre class="tool-params">{JSON.stringify(tool.parameters, null, 2)}</pre>
                  </div>
                {/each}
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
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-count {
    font-size: 0.68rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    padding: 0 4px 4px;
    flex-shrink: 0;
  }

  /* ── Usage summary bar ── */
  .usage-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 5px 8px;
    margin-bottom: 4px;
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
    font-size: 0.65rem;
    margin-right: 2px;
  }

  .usage-stat {
    color: var(--text-secondary);
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.7rem;
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
    border-radius: 5px;
    transition: border-color 0.1s;
  }

  .entry.open {
    border-color: var(--border);
    background: var(--surface-elevated);
  }

  .entry-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    padding: 5px 6px;
    border-radius: 5px;
    text-align: left;
    transition: background 0.08s;
  }

  .entry-row:hover {
    background: var(--surface-hover);
  }

  .entry.open .entry-row {
    border-radius: 5px 5px 0 0;
  }

  /* Two-line inner layout */
  .entry-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .entry-header-line {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .entry-meta {
    font-size: 0.68rem;
    color: var(--text-muted);
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .entry-content {
    font-size: 0.78rem;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  /* ── Type badge ── */
  .badge {
    font-size: 0.64rem;
    font-weight: 700;
    font-family: monospace;
    letter-spacing: 0.03em;
    padding: 1px 5px;
    border-radius: 3px;
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

  /* ── Tools block in session header ── */
  .tools-block {
    border-top: 1px solid var(--border);
    padding: 8px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tools-header {
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.72rem;
    color: var(--text-muted);
    letter-spacing: 0.03em;
    padding-bottom: 2px;
  }

  .tool-item {
    border-left: 2px solid var(--border);
    margin-left: 6px;
    padding-left: 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .tool-name {
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--accent);
  }

  .tool-desc {
    font-size: 0.78rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .tool-params {
    margin: 4px 0 0;
    font-family: 'Fira Code', 'Cascadia Code', Consolas, monospace;
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-all;
    line-height: 1.5;
    background: var(--surface-main);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 8px;
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
