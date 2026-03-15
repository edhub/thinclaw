/**
 * Chat store — manages conversation state using @mariozechner/pi-agent-core Agent.
 *
 * System prompt is assembled before every message from three sources:
 *   soul        — AI's identity (localStorage, can self-update via soul_update tool)
 *   memories    — persistent facts (IndexedDB, managed via memory_* tools)
 *   settings    — user's custom instructions
 *
 * After agent_end, new messages are persisted to IndexedDB.
 * Auto-compaction runs after each agent_end when context is nearly full.
 */
import { writable, derived, get } from 'svelte/store'
import { Agent } from '@mariozechner/pi-agent-core'
import type { AgentEvent, AgentMessage, AgentTool } from '@mariozechner/pi-agent-core'
import type { ImageContent, Message } from '@mariozechner/pi-ai'
import { nanoid } from '$lib/utils/nanoid'
import { getModelByKey, DEFAULT_UTILITY_MODEL_KEY } from '$lib/agent/models'
import { buildSystemPrompt, formatMemoriesForPrompt } from '$lib/agent/prompts'
import { getPersonaById } from '$lib/agent/personas'
import { soul } from '$lib/agent/soul'
import { memories } from '$lib/stores/memory'
import { browserTools } from '$lib/agent/tools'
import { imageGenerateTool } from '$lib/agent/image'
import { settings, getApiKeyForProvider } from '$lib/stores/settings'
import {
  listConversations,
  saveConversation,
  deleteConversation,
  getMessages,
  appendMessages,
  replaceAllMessages,
  type Conversation,
} from '$lib/db'
import { generateAiTitle, countUserMessages } from '$lib/agent/title'
import {
  compactMessages,
  estimateContextTokens,
  shouldCompact,
  shouldCompactProactive,
  shouldCompactByTime,
  CACHE_TTL_MS,
  type CompactionSummaryMessage,
  type MemoryUpdateMessage,
} from '$lib/agent/compaction'
import {
  recordSession,
  updateSessionTitle,
  sweepSessions,
  type SerializedTool,
  type SessionPayloadEntry,
} from '$lib/fs/session-recorder'

// ─── Streaming throttle (rAF batching) ───────────────────────────────────────
// Buffer incoming message_update events and flush at most once per animation
// frame. On fast models this cuts mobile re-renders from hundreds/sec to ~60.

/** Flush streaming updates at most twice per second — plenty for reading, easy on mobile. */
const STREAM_THROTTLE_MS = 500

let _pendingStreamMsg: AgentMessage | null = null
let _streamTimerId: ReturnType<typeof setTimeout> | null = null

function scheduleStreamingUpdate(msg: AgentMessage): void {
  _pendingStreamMsg = msg
  if (_streamTimerId === null) {
    _streamTimerId = setTimeout(() => {
      _streamTimerId = null
      if (_pendingStreamMsg) {
        streamingMessage.set({ ..._pendingStreamMsg })
        _pendingStreamMsg = null
      }
    }, STREAM_THROTTLE_MS)
  }
}

function cancelStreamingRaf(): void {
  if (_streamTimerId !== null) {
    clearTimeout(_streamTimerId)
    _streamTimerId = null
  }
  _pendingStreamMsg = null
}

// ─── Singleton agent ──────────────────────────────────────────────────────────

/** Return the utility model used for background tasks (compaction, auto-title). */
function getUtilityModel() {
  const s = get(settings)
  const key = s.utilityModelKey || DEFAULT_UTILITY_MODEL_KEY
  return getModelByKey(key)
}

/**
 * Convert AgentMessage[] → Message[] for the LLM.
 * Handles the built-in compactionSummary type by presenting it as a user message
 * so the LLM sees prior context without treating it as a live conversation turn.
 *
 * Memory injection: memories are prepended as a synthetic (user / assistant)
 * message pair so the system prompt stays stable and Anthropic's prompt cache
 * is not busted on every memory_save call. The injected messages are invisible
 * to the rest of the app (agent.state.messages is not affected).
 *
 * Error filtering: assistant messages with stopReason==='error' or errorMessage set
 * are excluded, along with their immediately preceding user message (the failed
 * request pair). This prevents broken exchanges from polluting the AI's context.
 */
function convertToLlm(messages: AgentMessage[]): Message[] {
  // Build the set of indices to skip: error assistant messages + preceding user messages.
  const skipSet = new Set<number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i] as any
    if (msg.role === 'assistant' && (msg.stopReason === 'error' || msg.errorMessage)) {
      skipSet.add(i)
      if (i > 0 && messages[i - 1].role === 'user') skipSet.add(i - 1)
    }
  }

  // Keep thinking blocks only for assistant messages within the last 3 user-turn
  // "blocks" (anchored on user message boundaries, not assistant count).
  //
  // WHY 3 turns (not 2): Anthropic prompt cache is prefix-based. If a thinking
  // block changes form between consecutive LLM calls (e.g. from full `thinking`
  // to `redacted_thinking`), the serialized bytes change, breaking the prefix
  // match and causing a full cache rewrite. With 2 turns, the boundary shifts
  // every new user message, causing the oldest kept thinking block to get
  // redacted — exactly when the prefix needs to stay stable. 3 turns gives a
  // buffer: blocks only get redacted when they're far enough back that the
  // prefix up to that point was already cached in a previous call.
  //
  // WHY user boundaries (not assistant count): a tool call adds a new assistant
  // message mid-turn, shifting an assistant-count window. User message indices
  // are stable within a tool-call sequence, so keepThinkingFromIdx stays the
  // same in Call #1 (tool call) and Call #2 (tool result) → identical prefix.
  const assistantIndices = messages
    .map((m, i) => ((m as any).role === 'assistant' ? i : -1))
    .filter((i) => i !== -1)
  const userIndices = messages
    .map((m, i) => ((m as any).role === 'user' ? i : -1))
    .filter((i) => i !== -1)
  // Start of the third-to-last user turn; keep thinking for all assistant
  // messages at or after that boundary.
  const keepThinkingFromIdx = userIndices.length >= 3 ? userIndices[userIndices.length - 3] : 0
  const recentAssistantSet = new Set(assistantIndices.filter((i) => i >= keepThinkingFromIdx))

  const converted = messages.flatMap((m, i) => {
    if (skipSet.has(i)) return []
    const msg = m as any
    if (msg.role === 'compactionSummary') {
      const cs = m as CompactionSummaryMessage
      return [
        {
          role: 'user' as const,
          content: [
            {
              type: 'text' as const,
              text: `[Summary of previous conversation]\n\n${cs.summary}`,
            },
          ],
          timestamp: cs.timestamp,
        } satisfies Message,
      ]
    }
    if (msg.role === 'assistant') {
      if (recentAssistantSet.has(i)) return [m as Message]
      // For older assistant messages, we cannot simply strip thinking blocks —
      // Anthropic requires all thinking blocks to be passed back in subsequent
      // requests (they carry a cryptographic signature). Stripping them entirely
      // can cause API errors or degrade reasoning continuity.
      //
      // Instead, convert each thinking block to its "redacted" form:
      //   { ...block, thinking: '', redacted: true }
      // anthropic.js will then send  { type: "redacted_thinking", data: signature }
      // which is Anthropic's official compact format (opaque payload only, no text).
      //
      // If a block has no signature (e.g. aborted mid-stream), we cannot create a
      // valid redacted_thinking entry, so we drop it — same as before.
      const content = (msg.content ?? []).flatMap((b: any) => {
        if (b.type !== 'thinking') return [b]
        if (b.thinkingSignature?.trim()) {
          // Keep signature, discard text content for token efficiency.
          return [{ ...b, thinking: '', redacted: true }]
        }
        // No signature → drop to avoid API rejection.
        return []
      })
      // If stripping left an empty content array, skip the message entirely
      // (same behaviour as before for all-thinking assistant turns).
      if (content.length === 0) return []
      return [{ ...msg, content } as Message]
    }
    if (msg.role === 'user' || msg.role === 'toolResult') {
      return [m as Message]
    }
    if (msg.role === 'memoryUpdate') {
      // Expand to a synthetic user/assistant pair at this fixed position.
      // The LLM sees a clear "[Memory updated]" marker at the point where new
      // memories were saved, without any content floating around between turns.
      const mu = m as unknown as MemoryUpdateMessage
      return [
        {
          role: 'user' as const,
          content: [{ type: 'text', text: `[Memory updated]\n\n${mu.memText}` }],
          timestamp: mu.timestamp,
        } satisfies Message,
        {
          role: 'assistant' as const,
          content: [{ type: 'text', text: "I've noted the memory update." }],
          timestamp: mu.timestamp,
        } as unknown as Message,
      ]
    }
    return []
  })

  // Prepend memories as a synthetic message pair so the system prompt stays
  // cache-stable. Uses _convMemSnapshot (set when the conversation was
  // selected/created, refreshed after compaction) — stable for the entire
  // session. Memories saved during this conversation appear as MemoryUpdateMessage
  // entries woven into the converted history above, at fixed positions.
  const memText = _convMemSnapshot
  if (!memText) return converted

  const memPrefix: Message[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `[Your memories from previous conversations]\n\n${memText}`,
        },
      ],
      timestamp: 0,
    },
    // Synthetic assistant ack — keeps the user/assistant alternation required by
    // Anthropic's API. Only `role` and `content` are read by the provider layer;
    // the remaining AssistantMessage fields are unused for injected messages.
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'I have reviewed my memories and will use them throughout this conversation.',
        },
      ],
      timestamp: 0,
    } as unknown as Message,
  ]
  return [...memPrefix, ...converted]
}

let _agent: Agent | null = null

/**
 * Captured LLM request payloads for the current agent run.
 * Cleared at the start of each prompt() and written to session JSONL on agent_end.
 */
let _capturedPayloads: SessionPayloadEntry[] = []

/**
 * onPayload hook for Anthropic prompt caching.
 *
 * Adds cache_control to the last tool definition — this creates a stable
 * cache prefix covering system prompt + all tools (~3,500 tokens). Since
 * tools never change during a session, every request reuses this prefix.
 *
 * pi-ai also places cache_control on the system prompt (~600 tokens, below
 * Anthropic's 1,024 minimum so effectively a no-op) and the last user
 * message (helps cross-turn caching).
 *
 * We intentionally do NOT mark intermediate user messages. The tools
 * breakpoint provides stable savings; message-level caching is handled
 * by pi-ai's last-user breakpoint automatically.
 *
 * Also captures request payloads for session JSONL debugging.
 */
function onAnthropicPayload(payload: unknown): unknown {
  const params = payload as Record<string, any>

  // Only apply to Anthropic-shaped payloads (has messages array, not Google's contents).
  if (!params?.messages || !Array.isArray(params.messages)) return payload

  // Add cache_control to the last tool definition (always stable).
  if (Array.isArray(params.tools) && params.tools.length > 0) {
    params.tools[params.tools.length - 1].cache_control = { type: 'ephemeral' as const }
  }

  // Capture a deep copy of the final params for session recording / debugging.
  try {
    _capturedPayloads.push({
      type: 'payload',
      timestamp: Date.now(),
      params: JSON.parse(JSON.stringify(params)),
    })
  } catch {
    // Non-fatal — don't break the agent if serialization fails.
  }

  return params
}

function getAgent(): Agent {
  if (!_agent) {
    _agent = new Agent({
      initialState: {
        tools: buildTools(false),
        systemPrompt: '',
      },
      convertToLlm,
      onPayload: onAnthropicPayload,
    })
    // Resolve api key dynamically so runtime changes are picked up.
    _agent.getApiKey = async (provider: string) => {
      return getApiKeyForProvider(provider, get(settings))
    }
    _agent.subscribe(handleAgentEvent)
  }
  return _agent
}

/** Build the agent tool list, optionally including the image generation tool. */
function buildTools(imageEnabled: boolean): AgentTool[] {
  return imageEnabled
    ? ([...browserTools, imageGenerateTool] as AgentTool[])
    : (browserTools as AgentTool[])
}

/**
 * Build the cache-stable system prompt: soul + persona + instructions only.
 *
 * Memories are intentionally excluded here and injected instead as a synthetic
 * message pair at the start of every LLM call by convertToLlm(). This keeps
 * the system prompt byte-for-byte identical across requests so Anthropic's
 * prompt cache is hit on every turn rather than invalidated by memory_save calls.
 */
function assembleSystemPrompt(convId?: string): string {
  const s = get(settings)
  const soulContent = soul.current()
  const id = convId ?? get(activeConversationId)
  const conv = get(conversations).find((c) => c.id === id)
  const persona = conv?.personaId ? getPersonaById(conv.personaId) : undefined
  // Pass empty memoriesText — memories live in the conversation via convertToLlm.
  return buildSystemPrompt(soulContent, '', s.systemPrompt, persona?.content)
}

// ─── Svelte stores ────────────────────────────────────────────────────────────
export const conversations = writable<Conversation[]>([])
export const activeConversationId = writable<string | null>(null)
export const activeMessages = writable<AgentMessage[]>([])
export const streamingMessage = writable<AgentMessage | null>(null)
export const isStreaming = writable(false)
export const streamError = writable<string | null>(null)
/** Number of follow-up messages queued via agent.followUp() waiting to be processed. */
export const queueLength = writable(0)
/**
 * Optimistic user message shown immediately after sendMessage() is called,
 * before the first message_end event confirms it's in agent.state.messages.
 */
export const pendingUserMessage = writable<AgentMessage | null>(null)
/** 'compacting' while auto-compaction LLM call is in flight. */
export const compactionStatus = writable<'idle' | 'compacting'>('idle')

/**
 * Content of the most recently attempted sendMessage call.
 * Used to enable "retry" on pre-request errors where no assistant message was created.
 */
export const lastPromptContent = writable<string>('')
export const lastPromptImages = writable<ImageContent[]>([])

export const activeConversation = derived(
  [conversations, activeConversationId],
  ([$convs, $id]) => $convs.find((c) => c.id === $id) ?? null,
)

/** Whether the image generation tool is enabled for the active conversation. */
export const imageToolEnabled = derived(
  activeConversation,
  ($conv) => $conv?.imageToolEnabled ?? false,
)

// Using a Map prevents cross-conversation pollution when onAgentEnd and
// selectConversation race on the same module-level variable.
const _prevMessageCounts = new Map<string, number>()

/**
 * Memory injection state — per-conversation, not per-turn.
 *
 * _convMemSnapshot / _convMemSnapshotIds
 *   Captured when a conversation is selected or created (and refreshed after
 *   compaction).  Injected at position 0 of every LLM request as a stable
 *   base; this prefix never changes mid-session so Anthropic can always cache
 *   it.  Memories saved during *this* conversation are NOT in here — they
 *   appear as MemoryUpdateMessage entries appended at their exact position in
 *   the conversation history (see appendMemoryUpdateIfNeeded).
 *
 * _memUpdateCoveredIds
 *   Tracks which memory IDs have already been appended as MemoryUpdateMessages
 *   in the current conversation so we don't duplicate them on subsequent turns.
 *   Reset whenever _convMemSnapshot is refreshed (selectConversation / after
 *   compaction).
 */
let _convMemSnapshot = ''
let _convMemSnapshotIds = new Set<string>()
let _memUpdateCoveredIds = new Set<string>()

/** Refresh the conversation-level memory baseline. Call on conversation select/create and after compaction. */
function refreshConvMemSnapshot(): void {
  const all = memories.all().filter((m) => (m.tier ?? 'general') === 'core')
  _convMemSnapshot = formatMemoriesForPrompt(all)
  _convMemSnapshotIds = new Set(all.map((m) => m.id))
  _memUpdateCoveredIds = new Set()
}

function handleAgentEvent(event: AgentEvent) {
  switch (event.type) {
    case 'agent_start':
      isStreaming.set(true)
      streamError.set(null)
      break

    case 'message_update':
      if (event.message.role === 'assistant') {
        scheduleStreamingUpdate(event.message)
      }
      break

    case 'message_end':
      // Cancel any pending rAF flush — the message is now finalised.
      cancelStreamingRaf()
      streamingMessage.set(null)
      activeMessages.set([...getAgent().state.messages])
      // User message is now in agent.state.messages — clear the optimistic placeholder.
      pendingUserMessage.set(null)
      // If this was a queued follow-up user message, decrement the counter.
      if ((event.message as any).role === 'user') {
        queueLength.update((n) => (n > 0 ? n - 1 : 0))
      }
      break

    case 'turn_end':
      // Note: error information lives on the assistant message itself (msg.errorMessage).
      // The ChatMessage component renders it as a collapsible error card — no need to
      // mirror it in the streamError banner here.
      break

    case 'agent_end':
      isStreaming.set(false)
      cancelStreamingRaf()
      streamingMessage.set(null)
      activeMessages.set([...getAgent().state.messages])
      queueLength.set(0) // safety reset — all follow-ups have been processed
      // Fire-and-forget: persist → auto-compact (order matters).
      // Catch here so IDB / compaction errors surface to the user instead of
      // becoming silent unhandled rejections.
      onAgentEnd().catch((err: unknown) => {
        console.error('[chat] Failed to save messages:', err)
        streamError.set('Failed to save messages — please refresh if they appear missing.')
      })
      break
  }
}

async function onAgentEnd(): Promise<void> {
  await persistNewMessages()
  await appendMemoryUpdateIfNeeded()
  await loadConversations()
  await maybeCompact()
  // Record session snapshot after compaction so the file reflects the final state.
  persistSessionSnapshot().catch((err: unknown) => {
    console.warn('[session] Failed to record session:', err)
  })
  // Auto-title after 5 rounds (fire-and-forget, non-blocking).
  const convId = get(activeConversationId)
  if (convId) maybeGenerateTitle(convId, 5).catch(() => {})
}

/** Write the current conversation to OPFS sessions/{convId}.jsonl. */
async function persistSessionSnapshot(): Promise<void> {
  const convId = get(activeConversationId)
  if (!convId) return
  const conv = get(conversations).find((c) => c.id === convId)
  const title = conv?.title ?? '新对话'
  const createdAt = conv?.createdAt ?? Date.now()
  const agent = getAgent()
  const model = agent.state.model?.id ?? ''
  const thinkingLevel = (agent.state as any).thinkingLevel ?? 'off'
  const systemPrompt = agent.state.systemPrompt ?? ''
  const messages = agent.state.messages
  if (messages.length === 0) return
  const tools: SerializedTool[] = (agent.state.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }))
  await recordSession(
    convId,
    title,
    createdAt,
    model,
    thinkingLevel,
    conv?.personaId,
    systemPrompt,
    messages,
    tools,
    _capturedPayloads.length > 0 ? _capturedPayloads : undefined,
  )
}

async function persistNewMessages(): Promise<void> {
  const convId = get(activeConversationId)
  if (!convId) return
  const all = getAgent().state.messages
  // Use per-conversation count so concurrent onAgentEnd / selectConversation
  // calls on different conversations don't overwrite each other's offsets.
  const prevCount = _prevMessageCounts.get(convId) ?? 0
  const newMsgs = all.slice(prevCount)
  if (newMsgs.length === 0) return
  await appendMessages(convId, newMsgs, prevCount)
  const conv = get(conversations).find((c) => c.id === convId)
  if (conv) {
    await saveConversation({ ...conv, updatedAt: Date.now() })
  }
  _prevMessageCounts.set(convId, all.length)
}

/**
 * After a turn ends, check whether any new memories were saved.
 * If so, append a MemoryUpdateMessage to the agent state and persist it.
 *
 * The message is appended at the current END of the conversation (after the
 * last assistant reply), where it stays permanently.  convertToLlm expands it
 * to a synthetic user/assistant pair at that fixed position so the Anthropic
 * prefix cache is never invalidated by earlier parts of the history.
 *
 * Race condition guard: IDB is written with the convId captured at the start
 * of this call.  After the async write we re-check the active conversation —
 * if the user switched away in the meantime we skip the in-memory / UI update
 * to avoid clobbering the new conversation's agent state.
 */
async function appendMemoryUpdateIfNeeded(): Promise<void> {
  const agent = getAgent()
  const convId = get(activeConversationId)
  if (!convId) return

  const allMems = memories.all().filter((m) => (m.tier ?? 'general') === 'core')
  const newMems = allMems.filter(
    (m) => !_convMemSnapshotIds.has(m.id) && !_memUpdateCoveredIds.has(m.id),
  )
  if (newMems.length === 0) return

  const deltaText = formatMemoriesForPrompt(newMems)
  const updateMsg: MemoryUpdateMessage = {
    role: 'memoryUpdate',
    memText: deltaText,
    timestamp: Date.now(),
  }

  const currentCount = agent.state.messages.length
  const newMessages = [...agent.state.messages, updateMsg as AgentMessage]

  // Persist first — IDB always gets the correct convId regardless of any
  // subsequent conversation switch.
  await appendMessages(convId, [updateMsg as AgentMessage], currentCount)

  // Skip in-memory / UI update if the user switched away during the async write.
  if (get(activeConversationId) !== convId) {
    console.info('[chat] conversation switched during appendMemoryUpdateIfNeeded; IDB updated, in-memory state skipped.')
    return
  }

  agent.replaceMessages(newMessages)
  activeMessages.set([...newMessages])
  _prevMessageCounts.set(convId, newMessages.length)

  // Mark these IDs as covered so future turns don't re-append them.
  for (const m of newMems) _memUpdateCoveredIds.add(m.id)
}

/**
 * Execute compaction: summarize old messages, update agent state + IDB + UI.
 * Called by both the post-turn safety net and the pre-send proactive check.
 */
async function runCompaction(): Promise<void> {
  const agent = getAgent()
  const convId = get(activeConversationId)
  const utilityModel = getUtilityModel()
  const apiKey = (await agent.getApiKey?.(utilityModel.provider)) ?? ''
  if (!apiKey) return

  const messages = agent.state.messages

  compactionStatus.set('compacting')
  try {
    const result = await compactMessages(messages, utilityModel, apiKey)

    if (convId) await replaceAllMessages(convId, result.messages)

    if (get(activeConversationId) !== convId) {
      console.info(
        '[compaction] conversation switched during compaction; IDB updated, in-memory state skipped.',
      )
      return
    }

    agent.replaceMessages(result.messages)
    if (convId) _prevMessageCounts.set(convId, result.messages.length)
    activeMessages.set([...result.messages])

    // After compaction the old MemoryUpdateMessages are gone (they were folded
    // into the summary).  Refresh the base snapshot so the new base includes
    // all memories that existed up to this point, clearing the delta tracking.
    refreshConvMemSnapshot()

    console.info(`[compaction] ${result.tokensBefore.toLocaleString()} tokens → compacted.`)
  } catch (err: unknown) {
    console.warn('[compaction] Auto-compaction failed:', err instanceof Error ? err.message : err)
  } finally {
    compactionStatus.set('idle')
  }
}

/**
 * Post-turn safety net: compact only when approaching the model's context limit.
 *
 * Proactive compaction (80k threshold) is intentionally excluded here because
 * this runs immediately after agent_end while the cache is still warm.
 * Compacting now would bust the growing prefix cache for no benefit.
 */
async function maybeCompact(): Promise<void> {
  const agent = getAgent()
  const mainModel = agent.state.model
  if (!mainModel) return

  const contextTokens = estimateContextTokens(agent.state.messages)
  if (!shouldCompact(contextTokens, mainModel)) return

  await runCompaction()
}

/**
 * Pre-send proactive check: compact before a new turn when the cache has
 * likely expired, making a smaller context cheaper than the full history.
 *
 * Two triggers (either fires compaction):
 *  1. Tokens > 80k AND idle gap > 5 min (Anthropic cache TTL expired)
 *  2. Cross-day: oldest uncompacted message is from a prior calendar day
 *     AND > CROSS_DAY_MIN_EXCHANGES user turns (cache definitely expired)
 */
async function maybeCompactPreSend(): Promise<void> {
  const agent = getAgent()
  const messages = agent.state.messages
  if (messages.length === 0) return

  const contextTokens = estimateContextTokens(messages)
  const lastMsg = messages[messages.length - 1] as any
  const idleMs = Date.now() - ((lastMsg?.timestamp as number | undefined) ?? 0)

  if (!shouldCompactProactive(contextTokens, idleMs) && !shouldCompactByTime(messages)) return

  await runCompaction()
}

// ─── Public API ───────────────────────────────────────────────────────────────

// loadConversations no longer calls memories.load() — memories are loaded
// once at app startup (see +page.svelte onMount) and kept in sync by
// memory_save / memory_delete tools incrementally.
export async function loadConversations(): Promise<void> {
  const list = await listConversations()
  conversations.set(list)
}

export async function selectConversation(id: string): Promise<void> {
  // Title the conversation we're leaving (if it still has the default title).
  const prevId = get(activeConversationId)
  if (prevId && prevId !== id) {
    maybeGenerateTitle(prevId, 1).catch(() => {})
  }

  const msgs = await getMessages(id)
  const agent = getAgent()
  const conv = get(conversations).find((c) => c.id === id)

  agent.setSystemPrompt(assembleSystemPrompt(id))
  const selectedModel = getModelByKey(get(settings).model)
  agent.setModel(selectedModel)
  agent.setThinkingLevel(selectedModel.reasoning ? 'medium' : 'off')
  agent.replaceMessages(msgs)
  agent.setTools(buildTools(conv?.imageToolEnabled ?? false))

  _prevMessageCounts.set(id, msgs.length)
  activeConversationId.set(id)
  activeMessages.set(msgs)
  streamingMessage.set(null)
  streamError.set(null)
  // Capture current memory state as the stable base for this conversation session.
  // Memories saved during this session appear as MemoryUpdateMessages in history.
  refreshConvMemSnapshot()
}

export async function createConversation(): Promise<string> {
  const s = get(settings)
  const id = nanoid()
  const now = Date.now()
  const conv: Conversation = {
    id,
    title: '新对话',
    model: s.model,
    createdAt: now,
    updatedAt: now,
  }
  await saveConversation(conv)
  conversations.update((list) => [conv, ...list])
  await selectConversation(id)
  return id
}

/**
 * Update the persona for the active conversation (only while it has no messages).
 * Immediately refreshes the agent's system prompt.
 */
export async function setConversationPersona(personaId: string | null): Promise<void> {
  const convId = get(activeConversationId)
  if (!convId) return
  // Guard: persona is locked once the conversation has messages.
  if (get(activeMessages).length > 0) return
  conversations.update((list) =>
    list.map((c) => (c.id === convId ? { ...c, personaId: personaId ?? undefined } : c)),
  )
  const conv = get(conversations).find((c) => c.id === convId)
  if (conv) await saveConversation(conv)
  // Immediately update agent system prompt to reflect the new persona.
  getAgent().setSystemPrompt(assembleSystemPrompt())
}

export async function removeConversation(id: string): Promise<void> {
  await deleteConversation(id)
  conversations.update((list) => list.filter((c) => c.id !== id))
  activeConversationId.update((current) => {
    if (current === id) {
      getAgent().replaceMessages([])
      _prevMessageCounts.delete(id)
      activeMessages.set([])
      streamingMessage.set(null)
      return null
    }
    return current
  })
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const now = Date.now()
  conversations.update((list) =>
    list.map((c) => (c.id === id ? { ...c, title, updatedAt: now } : c)),
  )
  // Read back from the already-updated store — no extra IDB round-trip needed.
  const conv = get(conversations).find((c) => c.id === id)
  if (conv) await saveConversation(conv)
  // Keep the session file header in sync (fire-and-forget — non-fatal).
  updateSessionTitle(id, title).catch(() => {})
}

/**
 * Toggle the image generation tool for the active conversation.
 * Persists to IndexedDB and immediately updates the agent's live tool list.
 */
export async function toggleImageTool(): Promise<void> {
  const convId = get(activeConversationId)
  if (!convId) return
  const next = !(get(activeConversation)?.imageToolEnabled ?? false)
  conversations.update((list) =>
    list.map((c) => (c.id === convId ? { ...c, imageToolEnabled: next } : c)),
  )
  const conv = get(conversations).find((c) => c.id === convId)
  if (conv) await saveConversation(conv)
  getAgent().setTools(buildTools(next))
}

export async function sendMessage(content: string, images: ImageContent[] = []): Promise<void> {
  const agent = getAgent()

  // Always track the last attempted content so the error banner retry is correct.
  lastPromptContent.set(content)
  lastPromptImages.set(images)

  const s = get(settings)
  const activeModel = getModelByKey(s.model)
  const requiredKey = getApiKeyForProvider(activeModel.provider, s)
  if (!requiredKey) {
    streamError.set('API key is not set. Please add it in Settings.')
    return
  }

  // If the agent is already running, queue this message as a follow-up.
  // The SDK's agent loop will process it automatically after the current turn.
  if (agent.state.isStreaming) {
    const userMsg: AgentMessage = {
      role: 'user',
      content:
        images.length > 0
          ? [{ type: 'text', text: content }, ...images]
          : [{ type: 'text', text: content }],
      timestamp: Date.now(),
    } as AgentMessage
    agent.followUp(userMsg)
    queueLength.update((n) => n + 1)
    return
  }

  let convId = get(activeConversationId)
  if (!convId) {
    convId = await createConversation()
  }

  // Rebuild system prompt before every message so soul/memory changes take effect
  const selectedModel = getModelByKey(s.model)
  agent.setSystemPrompt(assembleSystemPrompt())
  agent.setModel(selectedModel)
  agent.setThinkingLevel(selectedModel.reasoning ? 'medium' : 'off')

  // Proactive compaction: compact before this turn if the cache has likely
  // expired (idle > 5 min) and context is large, or if this is the first
  // message of a new day.  This runs pre-send so the actual LLM call benefits
  // from the smaller context immediately.
  await maybeCompactPreSend()

  _prevMessageCounts.set(convId, agent.state.messages.length)

  // Show the user message in the UI immediately — don't wait for the API round-trip.
  const userMsgContent: AgentMessage = {
    role: 'user',
    content:
      images.length > 0
        ? [{ type: 'text', text: content }, ...images]
        : [{ type: 'text', text: content }],
    timestamp: Date.now(),
  } as AgentMessage
  pendingUserMessage.set(userMsgContent)

  try {
    _capturedPayloads = [] // Clear previous payloads before new agent run
    await agent.prompt(content, images.length > 0 ? images : undefined)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    streamError.set(msg)
    pendingUserMessage.set(null)
  }
}

export function abortStreaming(): void {
  const agent = getAgent()
  // Clear queued follow-ups before aborting so stale messages don't resurface
  // on the next prompt() call.
  agent.clearFollowUpQueue()
  queueLength.set(0)
  agent.abort()
}

/**
 * Remove an error assistant message (and its immediately preceding user message)
 * from agent state, the active UI, and IndexedDB.
 *
 * Safe to call while the agent is idle. No-ops if the agent is currently streaming.
 */
export async function deleteErrorMessage(errorMsg: AgentMessage): Promise<void> {
  if (get(isStreaming)) return
  const agent = getAgent()
  const msgs = agent.state.messages
  const idx = msgs.indexOf(errorMsg)
  if (idx < 0) return

  // Also remove the user message that triggered this error, if present.
  const prevIdx = idx > 0 && msgs[idx - 1].role === 'user' ? idx - 1 : -1
  const filtered = msgs.filter((_, i) => i !== idx && i !== prevIdx)

  agent.replaceMessages(filtered)
  activeMessages.set([...filtered])

  const convId = get(activeConversationId)
  if (convId) {
    await replaceAllMessages(convId, filtered)
    _prevMessageCounts.set(convId, filtered.length)
  }
}

/**
 * Delete the error assistant message (and its preceding user message), then
 * re-send the same user content so the request is retried immediately.
 *
 * No-ops if the agent is currently streaming.
 */
export async function retryFromError(errorMsg: AgentMessage): Promise<void> {
  if (get(isStreaming)) return
  const agent = getAgent()
  const msgs = agent.state.messages
  const idx = msgs.indexOf(errorMsg)
  if (idx < 0) return

  // Extract the content we need to resend BEFORE deleting.
  const prevIdx = idx > 0 && msgs[idx - 1].role === 'user' ? idx - 1 : -1
  let content = ''
  let images: ImageContent[] = []
  if (prevIdx >= 0) {
    const prevMsg = msgs[prevIdx] as any
    if (typeof prevMsg.content === 'string') {
      content = prevMsg.content
    } else if (Array.isArray(prevMsg.content)) {
      content = prevMsg.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text as string)
        .join('')
      images = prevMsg.content.filter((b: any) => b.type === 'image') as ImageContent[]
    }
  }

  await deleteErrorMessage(errorMsg)

  if (content || images.length > 0) {
    await sendMessage(content, images)
  }
}

/**
 * Retry the last attempted sendMessage call.
 * Used by the pre-request error banner (e.g., when an API key is added after
 * the first attempt failed before the agent loop even started).
 */
export async function retryLastMessage(): Promise<void> {
  if (get(isStreaming)) return
  const content = get(lastPromptContent)
  const images = get(lastPromptImages)
  if (!content && images.length === 0) return
  await sendMessage(content, images)
}

// ─── AI title generation ──────────────────────────────────────────────────────

/**
 * Generate an AI title for a conversation if:
 *   - The title is still the default 'New conversation' (never been titled).
 *   - The user has sent at least `minRounds` messages.
 *
 * minRounds=5  → triggered after 5 back-and-forths
 * minRounds=1  → triggered on conversation switch (any content)
 */
async function maybeGenerateTitle(convId: string, minRounds: number): Promise<void> {
  const conv = get(conversations).find((c) => c.id === convId)
  // Skip if already titled.
  if (!conv || conv.title !== '新对话') return

  const agent = getAgent()
  const messages = agent.state.messages
  if (countUserMessages(messages) < minRounds) return

  const utilityModel = getUtilityModel()
  const apiKey = (await agent.getApiKey?.(utilityModel.provider)) ?? ''
  if (!apiKey) return

  try {
    const title = await generateAiTitle(messages, utilityModel, apiKey)
    if (title) await renameConversation(convId, title)
  } catch (err) {
    console.warn('[auto-title] Failed to generate title:', err instanceof Error ? err.message : err)
  }
}
