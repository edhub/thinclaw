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
import type { ImageContent, Model } from '@mariozechner/pi-ai'
import { streamSimple } from '@mariozechner/pi-ai'
import { nanoid } from '$lib/utils/nanoid'
import { getModelByKey, DEFAULT_UTILITY_MODEL_KEY } from '$lib/agent/models'
import { buildSystemPrompt, formatMemoriesForPrompt } from '$lib/agent/prompts'
import { getPersonaById } from '$lib/agent/personas'
import { soul } from '$lib/agent/soul'
import { memories } from '$lib/stores/memory'
import { browserTools } from '$lib/agent/tools'
import { imageGenerateTool } from '$lib/agent/image'
import { convertToLlm } from '$lib/agent/convert'
import { onPayload, capturedPayloads, clearCapturedPayloads } from '$lib/agent/payload'
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
} from '$lib/agent/compaction'
import { recordSession, updateSessionTitle, type SerializedTool } from '$lib/fs/session-recorder'

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

// ─── API call rate limiter ────────────────────────────────────────────────────
// Tracks the timestamp of the most recent outgoing LLM API call.
// The custom streamFn enforces a minimum gap between consecutive calls so that
// rapid tool-call loops don't hit provider rate limits.

let _lastApiCallMs = 0

/**
 * Enforce the configured inter-call delay.
 * Waits until `toolCallDelay` seconds have elapsed since the previous call,
 * then records the new call time.
 */
async function throttleApiCall(delayMs: number): Promise<void> {
  const now = Date.now()
  const elapsed = now - _lastApiCallMs
  if (_lastApiCallMs > 0 && elapsed < delayMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs - elapsed))
  }
  _lastApiCallMs = Date.now()
}

/**
 * Reset the rate limiter — called at the start of each fresh user prompt so
 * the very first API call in a new conversation turn is never artificially delayed.
 */
function resetApiCallThrottle(): void {
  _lastApiCallMs = 0
}

/** Return the utility model used for background tasks (compaction, auto-title). */
function getUtilityModel() {
  const s = get(settings)
  const key = s.utilityModelKey || DEFAULT_UTILITY_MODEL_KEY
  return getModelByKey(key)
}

let _agent: Agent | null = null

/**
 * Custom stream function that injects `Authorization: Bearer` headers for providers
 * (e.g. lingyaai) whose google-generative-ai proxy does not recognise the
 * `x-goog-api-key` header used by the @google/genai SDK.
 *
 * For every other model the call is passed through unchanged.
 */
function makeStreamFn() {
  return async function customStreamFn(
    model: Model<any>,
    context: Parameters<typeof streamSimple>[1],
    options: Parameters<typeof streamSimple>[2],
  ) {
    if (model.api === 'google-generative-ai' && model.provider === 'lingyaai') {
      const apiKey = getApiKeyForProvider(model.provider, get(settings))
      if (apiKey) {
        model = {
          ...model,
          headers: { Authorization: `Bearer ${apiKey}`, ...(model.headers ?? {}) },
        }
      }
    }
    // Enforce minimum inter-call delay to avoid provider rate limits.
    const delayMs = (get(settings).toolCallDelay ?? 4) * 1000
    await throttleApiCall(delayMs)
    return streamSimple(model, context, options)
  }
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
      streamFn: makeStreamFn(),
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
 * Assemble the full system prompt string for agent.setSystemPrompt().
 */
function assembleSystemPrompt(convId?: string): string {
  const s = get(settings)
  const soulContent = soul.current()
  const id = convId ?? get(activeConversationId)
  const conv = get(conversations).find((c) => c.id === id)
  const persona = conv?.personaId ? getPersonaById(conv.personaId) : undefined
  const memoriesText = formatMemoriesForPrompt(memories.all())

  return buildSystemPrompt(soulContent, persona?.content, s.systemPrompt, memoriesText)
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
    capturedPayloads.length > 0 ? capturedPayloads : undefined,
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
    clearCapturedPayloads() // Clear previous payloads before new agent run
    resetApiCallThrottle() // First API call of a fresh turn is never delayed
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
