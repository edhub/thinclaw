/**
 * Auto-compaction for long conversations.
 *
 * When context tokens exceed (contextWindow - reserveTokens), old messages are
 * summarized by the LLM and replaced with a single CompactionSummaryMessage.
 *
 * Strategy mirrors pi-coding-agent:
 *  1. Walk backwards from newest message accumulating token estimates.
 *  2. Snap cut point to nearest user / assistant boundary (never cut mid-toolResult).
 *  3. If cut lands inside an assistant turn (split-turn), generate two summaries in
 *     parallel (history + turn-prefix) and merge them.
 *  4. On subsequent compactions the previous summary is updated, not replaced.
 */

import { completeSimple, type Message, type Model, type Usage } from '@mariozechner/pi-ai'
import type { AgentMessage } from '@mariozechner/pi-agent-core'

// ─── Custom message type ──────────────────────────────────────────────────────

export interface CompactionSummaryMessage {
  role: 'compactionSummary'
  /** Structured markdown summary of the compacted conversation. */
  summary: string
  /** Context token count right before this compaction ran. */
  tokensBefore: number
  timestamp: number
}

// Extend pi-agent-core's union type so AgentMessage includes our custom message.
declare module '@mariozechner/pi-agent-core' {
  interface CustomAgentMessages {
    compactionSummary: CompactionSummaryMessage
  }
}

// ─── Config ───────────────────────────────────────────────────────────────────

/** Tokens reserved for the LLM's own response (not sent as context). */
export const RESERVE_TOKENS = 16_384

/** Recent tokens to keep verbatim (not summarized). */
export const KEEP_RECENT_TOKENS = 50_000

// ─── Token estimation ─────────────────────────────────────────────────────────

// CJK Unified Ideographs and common CJK ranges.
// Each CJK character typically maps to 1–2 tokens; we use 1.5 as a middle estimate.
// Latin/ASCII characters use the standard ~4 chars per token heuristic.
const CJK_RE =
  /[\u2E80-\u2FFF\u3000-\u303F\u3040-\u30FF\u3100-\u312F\u3200-\u32FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/

/** Estimate token count for a string, accounting for CJK characters. */
export function estimateStringTokens(str: string): number {
  let cjkChars = 0
  let otherChars = 0
  for (let i = 0; i < str.length; i++) {
    if (CJK_RE.test(str[i])) cjkChars++
    else otherChars++
  }
  return Math.ceil(cjkChars * 1.5 + otherChars / 4)
}

/** Estimate token count for one message, with CJK-aware string estimation. */
export function estimateTokens(message: AgentMessage): number {
  const msg = message as any

  switch (msg.role as string) {
    case 'user': {
      const c = msg.content
      if (typeof c === 'string') return estimateStringTokens(c)
      if (Array.isArray(c)) {
        let tokens = 0
        for (const b of c) {
          if (b.type === 'text' && b.text) tokens += estimateStringTokens(b.text as string)
          else if (b.type === 'image') tokens += 4_800 // ~1024×1024 image estimate
        }
        return tokens
      }
      return 0
    }
    case 'assistant': {
      let tokens = 0
      for (const b of msg.content ?? []) {
        if (b.type === 'text') tokens += estimateStringTokens(b.text as string)
        else if (b.type === 'thinking') tokens += estimateStringTokens(b.thinking as string)
        else if (b.type === 'toolCall')
          tokens += estimateStringTokens((b.name as string) + JSON.stringify(b.arguments))
      }
      return tokens
    }
    case 'toolResult': {
      const c = msg.content
      if (typeof c === 'string') return estimateStringTokens(c)
      if (Array.isArray(c)) {
        let tokens = 0
        for (const b of c) {
          if (b.type === 'text' && b.text) tokens += estimateStringTokens(b.text as string)
          if (b.type === 'image') tokens += 4_800
        }
        return tokens
      }
      return 0
    }
    case 'compactionSummary':
      return estimateStringTokens((msg as CompactionSummaryMessage).summary)

    default:
      return 0
  }
}

/**
 * Estimate total context tokens.
 * Uses the last assistant message's reported usage when available,
 * plus a char/4 estimate for any trailing messages after it.
 */
export function estimateContextTokens(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any
    if (
      msg.role === 'assistant' &&
      msg.usage &&
      msg.stopReason !== 'aborted' &&
      msg.stopReason !== 'error'
    ) {
      const u: Usage = msg.usage
      const base = u.totalTokens || u.input + u.output + u.cacheRead + u.cacheWrite
      let trailing = 0
      for (let j = i + 1; j < messages.length; j++) trailing += estimateTokens(messages[j])
      return base + trailing
    }
  }
  return messages.reduce((s, m) => s + estimateTokens(m), 0)
}

/** Return true when compaction should trigger. */
export function shouldCompact(contextTokens: number, model: Model<any>): boolean {
  return contextTokens > model.contextWindow - RESERVE_TOKENS
}

// ─── Cut-point detection ──────────────────────────────────────────────────────

/**
 * Indices where we may cut: user messages, assistant messages,
 * and compactionSummary (acts as a virtual turn start).
 * toolResult must never be a cut point — it must stay with its tool call.
 */
function validCutPoints(messages: AgentMessage[]): number[] {
  return messages.reduce<number[]>((acc, m, i) => {
    const r = (m as any).role as string
    if (r === 'user' || r === 'assistant' || r === 'compactionSummary') acc.push(i)
    return acc
  }, [])
}

/** Walk backwards from `from` to find the user/compactionSummary that started the turn. */
function findTurnStart(messages: AgentMessage[], from: number): number {
  for (let i = from; i >= 0; i--) {
    const r = (messages[i] as any).role as string
    if (r === 'user' || r === 'compactionSummary') return i
  }
  return -1
}

interface CutResult {
  firstKeptIndex: number
  turnStartIndex: number // -1 if not a split turn
  isSplitTurn: boolean
}

/**
 * Find the index of the first message to keep (same algorithm as coding-agent).
 * Walks backwards accumulating tokens, then snaps to the nearest valid cut point.
 */
function findCutPoint(messages: AgentMessage[], keepRecentTokens: number): CutResult {
  const cuts = validCutPoints(messages)
  if (cuts.length === 0) return { firstKeptIndex: 0, turnStartIndex: -1, isSplitTurn: false }

  let accumulated = 0
  let cutIndex = cuts[0] // default: keep everything

  for (let i = messages.length - 1; i >= 0; i--) {
    accumulated += estimateTokens(messages[i])
    if (accumulated >= keepRecentTokens) {
      for (const c of cuts) {
        if (c >= i) {
          cutIndex = c
          break
        }
      }
      break
    }
  }

  const role = (messages[cutIndex] as any).role as string
  const isUserLike = role === 'user' || role === 'compactionSummary'
  const turnStartIndex = isUserLike ? -1 : findTurnStart(messages, cutIndex)

  return {
    firstKeptIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserLike && turnStartIndex !== -1,
  }
}

// ─── Serialization ────────────────────────────────────────────────────────────

const TOOL_RESULT_MAX_CHARS = 2_000

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[... ${text.length - max} more characters truncated]`
}

/** Convert AgentMessage[] → Message[] for the summarization prompt. */
function toSummaryMessages(messages: AgentMessage[]): Message[] {
  return messages.flatMap((m) => {
    const msg = m as any
    switch (msg.role as string) {
      case 'compactionSummary':
        return [
          {
            role: 'user' as const,
            content: [
              { type: 'text', text: `[Previous context summary]\n\n${msg.summary as string}` },
            ],
            timestamp: msg.timestamp as number,
          },
        ]
      case 'user':
      case 'assistant':
      case 'toolResult':
        return [msg as Message]
      default:
        return []
    }
  })
}

/** Serialize Message[] to plain text (prevents the summarizer from continuing the chat). */
function serialize(messages: Message[]): string {
  const parts: string[] = []
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : (msg.content as any[])
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text as string)
              .join('')
      if (text) parts.push(`[User]: ${text}`)
    } else if (msg.role === 'assistant') {
      const texts: string[] = []
      const thinks: string[] = []
      const calls: string[] = []
      for (const b of msg.content as any[]) {
        if (b.type === 'text') texts.push(b.text)
        else if (b.type === 'thinking') thinks.push(b.thinking)
        else if (b.type === 'toolCall') {
          const args = b.arguments as Record<string, unknown>
          calls.push(
            `${b.name as string}(${Object.entries(args)
              .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
              .join(', ')})`,
          )
        }
      }
      if (thinks.length) parts.push(`[Assistant thinking]: ${thinks.join('\n')}`)
      if (texts.length) parts.push(`[Assistant]: ${texts.join('\n')}`)
      if (calls.length) parts.push(`[Assistant tool calls]: ${calls.join('; ')}`)
    } else if (msg.role === 'toolResult') {
      const text = (msg.content as any[])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text as string)
        .join('')
      if (text) parts.push(`[Tool result]: ${truncate(text, TOOL_RESULT_MAX_CHARS)}`)
    }
  }
  return parts.join('\n\n')
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`

const SUMMARIZE_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`

const UPDATE_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`

const TURN_PREFIX_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`

// ─── Summary generation ───────────────────────────────────────────────────────

async function generateSummary(
  messages: AgentMessage[],
  model: Model<any>,
  apiKey: string,
  signal?: AbortSignal,
  previousSummary?: string,
): Promise<string> {
  const maxTokens = Math.floor(0.8 * RESERVE_TOKENS)
  const basePrompt = previousSummary ? UPDATE_PROMPT : SUMMARIZE_PROMPT

  const conversationText = serialize(toSummaryMessages(messages))
  let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`
  }
  promptText += basePrompt

  const opts = model.reasoning
    ? { maxTokens, signal, apiKey, reasoning: 'high' as const }
    : { maxTokens, signal, apiKey }

  const response = await completeSimple(
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: [{ type: 'text', text: promptText }], timestamp: Date.now() },
      ],
    },
    opts,
  )

  if (response.stopReason === 'error') {
    throw new Error(`Summarization failed: ${response.errorMessage ?? 'Unknown error'}`)
  }

  return response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

async function generateTurnPrefixSummary(
  messages: AgentMessage[],
  model: Model<any>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const maxTokens = Math.floor(0.5 * RESERVE_TOKENS)
  const conversationText = serialize(toSummaryMessages(messages))
  const promptText = `<conversation>\n${conversationText}\n</conversation>\n\n${TURN_PREFIX_PROMPT}`

  const response = await completeSimple(
    model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: [{ type: 'text', text: promptText }], timestamp: Date.now() },
      ],
    },
    { maxTokens, signal, apiKey },
  )

  if (response.stopReason === 'error') {
    throw new Error(`Turn prefix summarization failed: ${response.errorMessage ?? 'Unknown error'}`)
  }

  return response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface CompactionResult {
  messages: AgentMessage[]
  summary: string
  tokensBefore: number
}

/**
 * Compact the agent's message history.
 *
 * Returns a new message array: [CompactionSummaryMessage, ...keptMessages].
 * Handles split turns (single turn exceeds keepRecentTokens) the same way
 * as coding-agent: two summaries generated in parallel and merged.
 * Iterative: if a CompactionSummaryMessage already exists at index 0,
 * it is passed as `previousSummary` so the new summary updates it.
 */
export async function compactMessages(
  messages: AgentMessage[],
  model: Model<any>,
  apiKey: string,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  const tokensBefore = estimateContextTokens(messages)

  // Check for existing compaction summary (iterative compaction)
  let startIndex = 0
  let previousSummary: string | undefined
  if ((messages[0] as any)?.role === 'compactionSummary') {
    startIndex = 1
    previousSummary = (messages[0] as CompactionSummaryMessage).summary
  }

  const slice = messages.slice(startIndex)
  const cut = findCutPoint(slice, KEEP_RECENT_TOKENS)

  const absFirstKept = startIndex + cut.firstKeptIndex
  const absTurnStart = cut.isSplitTurn ? startIndex + cut.turnStartIndex : -1

  const historyEnd = cut.isSplitTurn ? absTurnStart : absFirstKept
  const messagesToSummarize = messages.slice(startIndex, historyEnd)
  const turnPrefixMessages = cut.isSplitTurn ? messages.slice(absTurnStart, absFirstKept) : []
  const keptMessages = messages.slice(absFirstKept)

  let summary: string

  if (cut.isSplitTurn && turnPrefixMessages.length > 0) {
    // Generate both summaries in parallel
    const [historyResult, prefixResult] = await Promise.all([
      messagesToSummarize.length > 0
        ? generateSummary(messagesToSummarize, model, apiKey, signal, previousSummary)
        : Promise.resolve('No prior history.'),
      generateTurnPrefixSummary(turnPrefixMessages, model, apiKey, signal),
    ])
    summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${prefixResult}`
  } else {
    summary = await generateSummary(messagesToSummarize, model, apiKey, signal, previousSummary)
  }

  const compactionMsg: CompactionSummaryMessage = {
    role: 'compactionSummary',
    summary,
    tokensBefore,
    timestamp: Date.now(),
  }

  return {
    messages: [compactionMsg as AgentMessage, ...keptMessages],
    summary,
    tokensBefore,
  }
}
