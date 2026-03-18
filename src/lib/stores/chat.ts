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
    return []
  })

  return converted
}

let _agent: Agent | null = null

/**
 * Captured LLM request payloads for the current agent run.
 * Cleared at the start of each prompt() and written to session JSONL on agent_end.
 */
let _capturedPayloads: SessionPayloadEntry[] = []

/**
 * The most-recently assembled system prompt parts.
 * Updated by assembleSystemPrompt() and consumed by onPayload() to
 * reconstruct multi-part system structures before each API call.
 */
let _currentSystemPromptParts: { stableParts: string[]; memoryPart?: string } | null = null

/**
 * Unified onPayload hook — splits the system prompt into multiple parts and
 * applies Anthropic prompt-cache breakpoints.
 *
 * Provider routing (detected from payload shape):
 *
 *   Google     `params.contents` array present (not `messages`).
 *              Rewrites `params.config.systemInstruction` from a single string to
 *              a Content object with one part per prompt section:
 *                { role: "user", parts: [{ text: soul }, { text: persona }, ...] }
 *              Google has no inline cache_control — split is structural only.
 *
 *   Anthropic  `params.system` is a top-level array of text blocks.
 *              Rewrites to one block per prompt section with cache_control on the
 *              last block (covers entire system prefix, 1 of 2 breakpoints).
 *              Also adds cache_control to tools[-1] (2nd breakpoint) and removes
 *              the pi-ai auto-injected cache_control on the last user message
 *              (it shifts every turn, busting the cache each time).
 *
 *   OpenAI     `params.messages` present but no `params.system` array.
 *              System is a `{ role:"system" }` entry inside messages[].
 *              No cache_control support — passes through untouched.
 *
 * Also captures request payloads for session JSONL debugging.
 */
function onPayload(payload: unknown): unknown {
  const params = payload as Record<string, any>

  // ── Google ────────────────────────────────────────────────────────────────
  if (Array.isArray(params.contents)) {
    if (_currentSystemPromptParts && params.config?.systemInstruction) {
      const { stableParts, memoryPart } = _currentSystemPromptParts
      const allParts = [...stableParts, ...(memoryPart ? [memoryPart] : [])]
      if (allParts.length > 1) {
        // Replace string with a multi-part Content object so each section is
        // a distinct part (matching what Google does with a single string, but split).
        params.config.systemInstruction = {
          role: 'user',
          parts: allParts.map((text) => ({ text })),
        }
      }
    }

    try {
      _capturedPayloads.push({
        type: 'payload',
        timestamp: Date.now(),
        params: JSON.parse(JSON.stringify(params)),
      })
    } catch {
      // Non-fatal.
    }
    return params
  }

  // ── Anthropic / OpenAI (both use `messages` array) ────────────────────────
  if (!Array.isArray(params.messages)) return payload

  // Anthropic: top-level `system` is an array of text blocks.
  // OpenAI:    system is a { role:"system" } message inside `messages[]`.
  const isAnthropic = Array.isArray(params.system)

  if (isAnthropic) {
    // Rebuild system as multiple blocks (one per prompt part).
    // cache_control on the very last block covers the entire system prefix.
    if (_currentSystemPromptParts) {
      const { stableParts, memoryPart } = _currentSystemPromptParts
      const blocks: { type: string; text: string; cache_control?: { type: string } }[] = []

      for (const part of stableParts) {
        blocks.push({ type: 'text', text: part })
      }
      if (memoryPart) {
        blocks.push({ type: 'text', text: memoryPart })
      }
      // cache_control on the last block (memory if present, else last stable part).
      if (blocks.length > 0) {
        blocks[blocks.length - 1].cache_control = { type: 'ephemeral' }
      }
      if (blocks.length > 0) {
        params.system = blocks
      }
    }

    // Add cache_control to the last tool definition (always stable).
    if (Array.isArray(params.tools) && params.tools.length > 0) {
      params.tools[params.tools.length - 1].cache_control = { type: 'ephemeral' as const }
    }

    // Remove the cache_control that pi-ai auto-injects on the last user message.
    // That breakpoint shifts on every new turn, so it never actually hits the cache.
    for (const msg of params.messages) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          delete block.cache_control
        }
      }
    }
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
      onPayload: onPayload,
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
 * Assemble the system prompt from soul + persona + custom instructions + memories.
 * Returns a joined string for agent.setSystemPrompt().
 */
function assembleSystemPrompt(convId?: string): string {
  const s = get(settings)
  const soulContent = soul.current()
  const id = convId ?? get(activeConversationId)
  const conv = get(conversations).find((c) => c.id === id)
  const persona = conv?.personaId ? getPersonaById(conv.personaId) : undefined
  const memoriesText = formatMemoriesForPrompt(memories.all())

  const { stableParts, memoryPart } = buildSystemPrompt(
    soulContent,
    persona?.content,
    s.systemPrompt,
    memoriesText,
  )

  // Persist parts so onPayload() can reconstruct multi-block system arrays.
  _currentSystemPromptParts = { stableParts, memoryPart }

  return [...stableParts, ...(memoryPart ? [memoryPart] : [])].join('\n\n')
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
