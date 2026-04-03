<!--
  SessionViewer — JSONL data inspector for session files.

  Each entry is rendered as a row: type badge + key-field summary + expandable raw JSON.
  Goal: readable at a glance, full data accessible on demand.
-->
<script lang="ts">
  import { ChevronRight } from 'lucide-svelte'
  import type { SessionEntry } from '$lib/fs/session-recorder'

  interface Props {
    entries: SessionEntry[]
  }
  let { entries }: Props = $props()

  let expanded = $state<Set<number>>(new Set())

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

  function entryContent(entry: SessionEntry): string {
    try {
      if (entry.type === 'session') {
        const h = entry as any
        return [
          `"${h.conversationTitle}"`,
          h.model,
          `thinking: ${h.thinkingLevel ?? 'off'}`,
          ...(h.personaId ? [`persona: ${h.personaId}`] : []),
        ].join('  ·  ')
      }
      if (entry.type === 'payload') {
        const params = (entry as any).params ?? {}
        const parts: string[] = []
        if (params.system) parts.push(`sys:${JSON.stringify(params.system).length}c`)
        if (Array.isArray(params.tools)) parts.push(`tools:${params.tools.length}`)
        if (params.thinking) parts.push(`thinking:${JSON.stringify(params.thinking)}`)
        parts.push(`max_tokens:${params.max_tokens ?? '?'}`)
        const ccPos: string[] = []
        if (params.system?.[params.system.length - 1]?.cache_control) ccPos.push('sys')
        if (Array.isArray(params.tools) && params.tools[params.tools.length - 1]?.cache_control)
          ccPos.push('tools[-1]')
        if (ccPos.length) parts.push(`cc:[${ccPos.join(',')}]`)
        return parts.join('  ·  ')
      }
      if (entry.type === 'message') {
        const msg = (entry as any).message
        const role: string = msg?.role ?? '?'
        if (role === 'user') return snippet(textOf(msg.content))
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
          return parts.join('  ·  ') || '(empty)'
        }
        if (role === 'toolResult') {
          const txt = (msg.content ?? [])
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text as string)
            .join('')
          return `${msg.toolName}  ·  ${msg.isError ? '❌  ' : ''}${snippet(txt)}`
        }
        if (role === 'compactionSummary') {
          return `~${msg.tokensBefore?.toLocaleString() ?? '?'} tokens → ${snippet(msg.summary ?? '')}`
        }
        return snippet(JSON.stringify(msg))
      }
    } catch {
      /* fall through */
    }
    return ''
  }

  function textOf(content: unknown): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content))
      return content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text as string)
        .join('')
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

  function prettyJson(entry: SessionEntry): string {
    return JSON.stringify(
      entry,
      (_key, value) => {
        if (typeof value === 'string' && value.length > 200 && /^[A-Za-z0-9+/=]+$/.test(value))
          return `[base64 ~${Math.round(value.length / 1024)}KB — truncated]`
        return value
      },
      2,
    )
  }

  function extractGeneratedImage(entry: SessionEntry): {
    imageData: string
    mimeType: string
    prompt: string
    aspectRatio: string
    imageSize: string
  } | null {
    if (entry.type !== 'message') return null
    const msg = (entry as any).message
    if (msg?.role !== 'toolResult' || msg?.toolName !== 'generate_image') return null
    const d = msg?.details
    return d?.imageData ? d : null
  }
</script>

<!-- ── Inspector container ───────────────────────────────────────────────── -->
<div class="flex-1 overflow-y-auto px-2.5 py-2 flex flex-col gap-0.5">
  <div
    class="text-[0.68rem] text-fg-muted uppercase tracking-[0.06em] font-semibold
              px-1 pb-1 shrink-0"
  >
    {entries.length} entries
  </div>

  <!-- Usage summary -->
  {#if totalUsage.turns > 0}
    <div
      class="flex flex-wrap items-center gap-1 px-2 py-1.5 mb-1 bg-surface-elevated
                border border-line rounded-md text-[0.72rem] shrink-0"
    >
      <span class="font-semibold text-fg-muted uppercase tracking-[0.05em] text-[0.65rem] mr-0.5">
        Token 用量
      </span>
      <span class="text-fg-sub font-mono text-[0.7rem]"
        >↑ {totalUsage.input.toLocaleString()} input</span
      >
      <span class="text-line text-[0.7rem]">·</span>
      <span class="text-fg-sub font-mono text-[0.7rem]"
        >↓ {totalUsage.output.toLocaleString()} output</span
      >
      {#if totalUsage.cacheRead > 0}
        <span class="text-line text-[0.7rem]">·</span>
        <span class="text-accent font-mono text-[0.7rem]"
          >⚡ {totalUsage.cacheRead.toLocaleString()} cache read</span
        >
      {:else}
        <span class="text-line text-[0.7rem]">·</span>
        <span class="text-fg-muted opacity-70 font-mono text-[0.7rem]">⚡ cache: 0</span>
      {/if}
      {#if totalUsage.cacheWrite > 0}
        <span class="text-line text-[0.7rem]">·</span>
        <span class="text-fg-sub font-mono text-[0.7rem]"
          >⬡ {totalUsage.cacheWrite.toLocaleString()} cache write</span
        >
      {/if}
    </div>
  {/if}

  <!-- Entry list -->
  {#each entries as entry, i (i)}
    {@const kind = badgeKind(entry)}
    {@const label = badgeLabel(entry)}
    {@const meta = entryMeta(entry)}
    {@const content = entryContent(entry)}
    {@const open = expanded.has(i)}

    <div
      class="border rounded-[5px] transition-colors duration-100"
      class:border-transparent={!open}
      class:border-line={open}
      class:bg-surface-elevated={open}
    >
      <!-- Summary row -->
      <button
        class="flex items-start gap-2 w-full bg-transparent border-none cursor-pointer
               px-1.5 py-[5px] text-left transition-colors duration-[80ms]
               hover:bg-surface-hover"
        class:rounded-md={!open}
        class:rounded-t-md={open}
        onclick={() => toggle(i)}
        type="button"
      >
        <div class="flex-1 min-w-0 flex flex-col gap-0.5">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="sv-badge sv-badge-{kind}">{label}</span>
            {#if meta}
              <span
                class="text-[0.68rem] text-fg-muted font-mono whitespace-nowrap
                           overflow-hidden text-ellipsis"
              >
                {meta}
              </span>
            {/if}
          </div>
          {#if content}
            <span
              class="text-[0.78rem] text-fg-sub whitespace-nowrap overflow-hidden
                         text-ellipsis block"
            >
              {content}
            </span>
          {/if}
        </div>
        <ChevronRight
          size={10}
          class="shrink-0 text-fg-muted transition-transform duration-150 mt-px
                 {open ? 'rotate-90' : ''}"
        />
      </button>

      <!-- Expanded body -->
      {#if open}
        {#if entry.type === 'session'}
          {@const h = entry as any}
          <div class="border-t border-line rounded-b-md overflow-hidden">
            <!-- Metadata JSON -->
            <div class="border-b border-line">
              <pre
                class="m-0 px-3.5 py-2.5 pb-1 font-mono text-[0.78rem] leading-[1.6]
                           text-fg whitespace-pre-wrap break-all overflow-x-auto">{JSON.stringify(
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
            <!-- System prompt -->
            {#if h.systemPrompt}
              <div class="flex flex-col">
                <span
                  class="sysprompt-label font-mono text-[0.72rem] text-fg-muted
                              px-3.5 pt-1.5 pb-0.5 tracking-[0.03em]"
                >
                  systemPrompt
                </span>
                <pre
                  class="m-0 ml-3.5 px-3.5 pb-3.5 pt-1 pl-2.5 font-mono text-[0.78rem]
                             leading-[1.65] text-fg whitespace-pre-wrap break-words
                             border-l-2 border-line">{h.systemPrompt}</pre>
              </div>
            {/if}
            <!-- Tools -->
            {#if h.tools && h.tools.length > 0}
              <div class="border-t border-line px-3.5 py-2 pb-3 flex flex-col gap-2.5">
                <div class="font-mono text-[0.72rem] text-fg-muted tracking-[0.03em] pb-0.5">
                  tools ({h.tools.length})
                </div>
                {#each h.tools as tool}
                  <div class="border-l-2 border-line ml-1.5 pl-2.5 flex flex-col gap-0.5">
                    <div class="font-mono text-[0.8rem] font-semibold text-accent">{tool.name}</div>
                    <div class="text-[0.78rem] text-fg-sub leading-[1.5]">{tool.description}</div>
                    <pre
                      class="mt-1 mb-0 font-mono text-[0.72rem] text-fg-muted whitespace-pre-wrap
                                 break-all leading-[1.5] bg-surface border border-line rounded
                                 px-2 py-1.5">{JSON.stringify(tool.parameters, null, 2)}</pre>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          {@const img = extractGeneratedImage(entry)}
          {#if img}
            <div class="border-t border-line px-3.5 py-2.5">
              <img
                src="data:{img.mimeType};base64,{img.imageData}"
                alt={img.prompt}
                class="block max-w-full rounded-md border border-line"
              />
              <div class="flex items-center justify-between mt-1.5">
                <span class="text-[0.72rem] text-fg-muted font-mono">
                  {img.aspectRatio} · {img.imageSize}
                </span>
                <a
                  href="data:{img.mimeType};base64,{img.imageData}"
                  download="generated-{(entry as any).message?.timestamp ??
                    Date.now()}.{img.mimeType.split('/')[1] ?? 'png'}"
                  class="text-[0.75rem] text-accent no-underline px-1.5 py-0.5 rounded
                         transition-colors duration-100 hover:bg-surface-active">↓ 保存图片</a
                >
              </div>
            </div>
          {/if}
          <pre
            class="m-0 px-3.5 py-2.5 pb-3 font-mono text-[0.78rem] leading-[1.6] text-fg
                   whitespace-pre-wrap break-all overflow-x-auto border-t border-line rounded-b-md">{prettyJson(
              entry,
            )}</pre>
        {/if}
      {/if}
    </div>
  {/each}

  {#if entries.length === 0}
    <div class="text-fg-muted text-sm text-center py-10">No entries found.</div>
  {/if}
</div>

<style>
  /* ::before/::after pseudo-content — not expressible with Tailwind */
  .sysprompt-label::before {
    content: '"';
  }
  .sysprompt-label::after {
    content: '":';
  }
</style>
