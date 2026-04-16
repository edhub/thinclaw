/**
 * Chat store — manages conversation state using @mariozechner/pi-agent-core Agent.
 *
 * Each conversation gets its own Agent instance, allowing multiple conversations
 * to stream concurrently. Users can freely switch topics while an AI reply is in
 * progress — the background agent keeps running uninterrupted.
 *
 * Per-conversation state is held in `_convStates: Writable<Record<string, ConvState>>`.
 * The exported reactive stores (isStreaming, activeMessages, …) are all `derived`
 * from the currently active conversation's slice of that record.
 *
 * System prompt is assembled before every message from three sources:
 *   soul        — AI's identity (localStorage, can self-update via soul_update tool)
 *   memories    — persistent facts (IndexedDB, managed via memory_* tools)
 *   settings    — user's custom instructions
 *
 * After agent_end, new messages are persisted to IndexedDB.
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
import { imageGenerateTool, imageEditTool, setLastImageContextFromUpload } from '$lib/agent/image'
import { settings, getApiKeyForProvider } from '$lib/stores/settings'
import {
  listConversations,
  saveConversation,
  deleteConversation,
  getMessages,
  appendMessages,
  replaceAllMessages,
  sweepOldConversations,
  type Conversation,
} from '$lib/db'
import { generateAiTitle, countUserMessages } from '$lib/agent/title'
import { injectBailianCacheControl } from '$lib/agent/bailian-cache'
import { recordSession, updateSessionTitle, type SerializedTool } from '$lib/fs/session-recorder'
import type { SessionPayloadEntry } from '$lib/fs/session-recorder'

// ─── Per-conversation state ───────────────────────────────────────────────────

interface ConvState {
  messages: AgentMessage[]
  streamingMessage: AgentMessage | null
  isStreaming: boolean
  streamError: string | null
  pendingUserMessage: AgentMessage | null
  queueLength: number
  lastPromptContent: string
  lastPromptImages: ImageContent[]
}

function defaultConvState(): ConvState {
  return {
    messages: [],
    streamingMessage: null,
    isStreaming: false,
    streamError: null,
    pendingUserMessage: null,
    queueLength: 0,
    lastPromptContent: '',
    lastPromptImages: [],
  }
}

/** Per-conversation agent instances (created lazily on first access). */
const _agents = new Map<string, Agent>()

/** Per-conversation captured LLM payloads for session recording. */
const _convPayloads = new Map<string, SessionPayloadEntry[]>()

/** Reactive per-conversation state map. Updating any field creates a new object ref. */
const _convStates = writable<Record<string, ConvState>>({})

function getConvState(convId: string): ConvState {
  return get(_convStates)[convId] ?? defaultConvState()
}

function updateConvState(convId: string, patch: Partial<ConvState>): void {
  _convStates.update((s) => ({
    ...s,
    [convId]: { ...(s[convId] ?? defaultConvState()), ...patch },
  }))
}

// ─── Streaming throttle (rAF batching) — per conversation ────────────────────
const STREAM_THROTTLE_MS = 500

const _pendingStreamMsgs = new Map<string, AgentMessage>()
const _streamTimerIds = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleStreamingUpdate(convId: string, msg: AgentMessage): void {
  _pendingStreamMsgs.set(convId, msg)
  if (!_streamTimerIds.has(convId)) {
    const timerId = setTimeout(() => {
      _streamTimerIds.delete(convId)
      const pending = _pendingStreamMsgs.get(convId)
      if (pending) {
        _pendingStreamMsgs.delete(convId)
        updateConvState(convId, { streamingMessage: { ...pending } })
      }
    }, STREAM_THROTTLE_MS)
    _streamTimerIds.set(convId, timerId)
  }
}

function cancelStreamingRaf(convId: string): void {
  const timerId = _streamTimerIds.get(convId)
  if (timerId !== undefined) {
    clearTimeout(timerId)
    _streamTimerIds.delete(convId)
  }
  _pendingStreamMsgs.delete(convId)
}

// ─── API call rate limiter — per conversation ─────────────────────────────────
const _lastApiCallMs = new Map<string, number>()

async function throttleApiCall(convId: string, delayMs: number): Promise<void> {
  const last = _lastApiCallMs.get(convId) ?? 0
  const now = Date.now()
  const elapsed = now - last
  if (last > 0 && elapsed < delayMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs - elapsed))
  }
  _lastApiCallMs.set(convId, Date.now())
}

function resetApiCallThrottle(convId: string): void {
  _lastApiCallMs.delete(convId)
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/** Return the utility model used for background tasks (compaction, auto-title). */
function getUtilityModel() {
  const s = get(settings)
  const key = s.utilityModelKey || DEFAULT_UTILITY_MODEL_KEY
  return getModelByKey(key)
}

/** Build the agent tool list. Image tools are always included when configured. */
function buildTools(): AgentTool[] {
  return [...browserTools, imageGenerateTool, imageEditTool] as AgentTool[]
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

// ─── Per-conversation Agent factory ──────────────────────────────────────────

function makeStreamFn(convId: string) {
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
    const delayMs = (get(settings).toolCallDelay ?? 4) * 1000
    await throttleApiCall(convId, delayMs)
    return streamSimple(model, context, options)
  }
}

function makePayloadHandler(convId: string): (payload: unknown, model: Model<any>) => unknown {
  return (payload: unknown, model: Model<any>): unknown => {
    // Inject explicit cache markers for Bailian (DashScope) before recording snapshot.
    if (model?.provider === 'bailian') {
      payload = injectBailianCacheControl(payload)
    }
    try {
      const payloads = _convPayloads.get(convId) ?? []
      payloads.push({
        type: 'payload',
        timestamp: Date.now(),
        params: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
      })
      _convPayloads.set(convId, payloads)
    } catch {
      // Non-fatal
    }
    return payload
  }
}

function getAgent(convId: string): Agent {
  if (_agents.has(convId)) return _agents.get(convId)!
  const agent = new Agent({
    initialState: {
      tools: buildTools(),
      systemPrompt: '',
    },
    onPayload: makePayloadHandler(convId),
    streamFn: makeStreamFn(convId),
  })
  agent.getApiKey = async (provider: string) => {
    return getApiKeyForProvider(provider, get(settings))
  }
  agent.subscribe((event) => handleAgentEvent(convId, event))
  _agents.set(convId, agent)
  return agent
}

/** Guard against double-initialisation when selectConversation is called
 * twice for the same unseen conversation before the first IDB read completes. */
const _initializingConvs = new Set<string>()

const _prevMessageCounts = new Map<string, number>()

function handleAgentEvent(convId: string, event: AgentEvent) {
  switch (event.type) {
    case 'agent_start':
      updateConvState(convId, { isStreaming: true, streamError: null })
      break

    case 'message_update':
      if (event.message.role === 'assistant') {
        scheduleStreamingUpdate(convId, event.message)
      }
      break

    case 'message_end': {
      cancelStreamingRaf(convId)
      const agent = _agents.get(convId)
      const msgs = agent ? [...agent.state.messages] : []
      const patch: Partial<ConvState> = {
        streamingMessage: null,
        messages: msgs,
        pendingUserMessage: null,
      }
      if ((event.message as any).role === 'user') {
        const curr = getConvState(convId)
        patch.queueLength = Math.max(0, curr.queueLength - 1)
      }
      updateConvState(convId, patch)
      break
    }

    case 'agent_end': {
      const agent = _agents.get(convId)
      cancelStreamingRaf(convId)
      updateConvState(convId, {
        isStreaming: false,
        streamingMessage: null,
        messages: agent ? [...agent.state.messages] : [],
        queueLength: 0,
      })
      onAgentEnd(convId).catch((err: unknown) => {
        console.error('[chat] Failed to save messages:', err)
        updateConvState(convId, {
          streamError: 'Failed to save messages — please refresh if they appear missing.',
        })
      })
      break
    }
  }
}

async function onAgentEnd(convId: string): Promise<void> {
  await persistNewMessages(convId)
  await loadConversations()
  persistSessionSnapshot(convId).catch((err: unknown) => {
    console.warn('[session] Failed to record session:', err)
  })
  maybeGenerateTitle(convId, 5).catch(() => {})
}

/** Write the conversation to OPFS sessions/{convId}.jsonl. */
async function persistSessionSnapshot(convId: string): Promise<void> {
  const conv = get(conversations).find((c) => c.id === convId)
  const title = conv?.title ?? '新对话'
  const createdAt = conv?.createdAt ?? Date.now()
  const agent = _agents.get(convId)
  if (!agent) return
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
  const payloads = _convPayloads.get(convId)
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
    payloads && payloads.length > 0 ? payloads : undefined,
  )
  // Clear after recording so old payloads don't re-appear on next snapshot
  _convPayloads.set(convId, [])
}

async function persistNewMessages(convId: string): Promise<void> {
  const agent = _agents.get(convId)
  if (!agent) return
  const all = agent.state.messages
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

// ─── Svelte stores ────────────────────────────────────────────────────────────
export const conversations = writable<Conversation[]>([])
export const activeConversationId = writable<string | null>(null)

// Derived from the active conversation's per-conv state
export const activeMessages = derived(
  [_convStates, activeConversationId],
  ([$s, $id]) => ($id ? ($s[$id]?.messages ?? []) : []),
)
export const streamingMessage = derived(
  [_convStates, activeConversationId],
  ([$s, $id]) => ($id ? ($s[$id]?.streamingMessage ?? null) : null),
)
export const isStreaming = derived(
  [_convStates, activeConversationId],
  ([$s, $id]) => ($id ? ($s[$id]?.isStreaming ?? false) : false),
)
export const streamError = derived(
  [_convStates, activeConversationId],
  ([$s, $id]) => ($id ? ($s[$id]?.streamError ?? null) : null),
)
export const queueLength = derived(
  [_convStates, activeConversationId],
  ([$s, $id]) => ($id ? ($s[$id]?.queueLength ?? 0) : 0),
)
export const pendingUserMessage = derived(
  [_convStates, activeConversationId],
  ([$s, $id]) => ($id ? ($s[$id]?.pendingUserMessage ?? null) : null),
)
export const lastPromptContent = derived(
  [_convStates, activeConversationId],
  ([$s, $id]) => ($id ? ($s[$id]?.lastPromptContent ?? '') : ''),
)
export const lastPromptImages = derived(
  [_convStates, activeConversationId],
  ([$s, $id]) => ($id ? ($s[$id]?.lastPromptImages ?? []) : []),
)

/**
 * Set of conversation IDs that are currently streaming.
 * Used by the sidebar to show per-conversation streaming indicators.
 */
export const streamingConversationIds = derived(_convStates, ($s) => {
  const ids = new Set<string>()
  for (const [id, state] of Object.entries($s)) {
    if (state.isStreaming) ids.add(id)
  }
  return ids
})

export const activeConversation = derived(
  [conversations, activeConversationId],
  ([$convs, $id]) => $convs.find((c) => c.id === $id) ?? null,
)

// ─── Public API ───────────────────────────────────────────────────────────────

export async function loadConversations(): Promise<void> {
  await sweepOldConversations()
  const list = await listConversations()
  conversations.set(list)
}

export async function selectConversation(id: string): Promise<void> {
  // Title the conversation we're leaving (if it still has the default title).
  const prevId = get(activeConversationId)
  if (prevId && prevId !== id) {
    maybeGenerateTitle(prevId, 1).catch(() => {})
  }

  // Switch the active pointer immediately so the UI feels responsive.
  activeConversationId.set(id)

  const existingState = get(_convStates)[id]

  if (!existingState && !_initializingConvs.has(id)) {
    // First visit: load messages from IndexedDB and initialise the agent.
    _initializingConvs.add(id)
    const msgs = await getMessages(id)
    _initializingConvs.delete(id)
    const agent = getAgent(id)

    agent.setSystemPrompt(assembleSystemPrompt(id))
    const selectedModel = getModelByKey(get(settings).model)
    agent.setModel(selectedModel)
    agent.setThinkingLevel(selectedModel.reasoning ? 'medium' : 'off')
    agent.replaceMessages(msgs)
    agent.setTools(buildTools())
    _prevMessageCounts.set(id, msgs.length)

    updateConvState(id, { messages: msgs })
  } else if (!existingState.isStreaming) {
    // Already visited but idle — refresh system prompt and model in case settings changed.
    const agent = getAgent(id)
    agent.setSystemPrompt(assembleSystemPrompt(id))
    const selectedModel = getModelByKey(get(settings).model)
    agent.setModel(selectedModel)
    agent.setThinkingLevel(selectedModel.reasoning ? 'medium' : 'off')
  }
  // If the conversation is currently streaming, leave the agent completely untouched.
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
  if (get(activeMessages).length > 0) return
  conversations.update((list) =>
    list.map((c) => (c.id === convId ? { ...c, personaId: personaId ?? undefined } : c)),
  )
  const conv = get(conversations).find((c) => c.id === convId)
  if (conv) await saveConversation(conv)
  const agent = _agents.get(convId)
  if (agent) agent.setSystemPrompt(assembleSystemPrompt())
}

export async function starConversation(id: string, starred: boolean): Promise<void> {
  conversations.update((list) => list.map((c) => (c.id === id ? { ...c, starred } : c)))
  const conv = get(conversations).find((c) => c.id === id)
  if (conv) await saveConversation(conv)
}

export async function removeConversation(id: string): Promise<void> {
  await deleteConversation(id)
  conversations.update((list) => list.filter((c) => c.id !== id))

  // Abort and clean up the agent if it exists.
  const agent = _agents.get(id)
  if (agent) {
    try {
      agent.clearFollowUpQueue?.()
      agent.abort?.()
    } catch {}
    _agents.delete(id)
  }
  _convStates.update((s) => {
    const { [id]: _, ...rest } = s
    return rest
  })
  _convPayloads.delete(id)
  _prevMessageCounts.delete(id)
  cancelStreamingRaf(id)

  activeConversationId.update((current) => {
    if (current === id) return null
    return current
  })
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const now = Date.now()
  conversations.update((list) =>
    list.map((c) => (c.id === id ? { ...c, title, updatedAt: now } : c)),
  )
  const conv = get(conversations).find((c) => c.id === id)
  if (conv) await saveConversation(conv)
  updateSessionTitle(id, title).catch(() => {})
}

/** Clear streamError for the active conversation (replaces the old streamError.set(null)). */
export function clearStreamError(): void {
  const id = get(activeConversationId)
  if (id) updateConvState(id, { streamError: null })
}

/** Construct a user AgentMessage from text content and optional images. */
function buildUserMessage(content: string, images: ImageContent[]): AgentMessage {
  return {
    role: 'user',
    content:
      images.length > 0
        ? [{ type: 'text', text: content }, ...images]
        : [{ type: 'text', text: content }],
    timestamp: Date.now(),
  } as AgentMessage
}

export async function sendMessage(content: string, images: ImageContent[] = []): Promise<void> {
  let convId = get(activeConversationId)
  if (!convId) {
    convId = await createConversation()
  }

  // Always track the last attempted content so the error banner retry is correct.
  updateConvState(convId, { lastPromptContent: content, lastPromptImages: images })

  if (images.length > 0) {
    setLastImageContextFromUpload(images[0].data, images[0].mimeType).catch(() => {})
  }

  const s = get(settings)
  const activeModel = getModelByKey(s.model)
  const requiredKey = getApiKeyForProvider(activeModel.provider, s)
  if (!requiredKey) {
    updateConvState(convId, {
      streamError: 'API key is not set. Please add it in Settings.',
    })
    return
  }

  const agent = getAgent(convId)

  // If the agent is already running, queue this message as a follow-up.
  if (agent.state.isStreaming) {
    agent.followUp(buildUserMessage(content, images))
    updateConvState(convId, { queueLength: getConvState(convId).queueLength + 1 })
    return
  }

  // Rebuild system prompt before every message so soul/memory changes take effect
  const selectedModel = getModelByKey(s.model)
  agent.setSystemPrompt(assembleSystemPrompt(convId))
  agent.setModel(selectedModel)
  agent.setThinkingLevel(selectedModel.reasoning ? 'medium' : 'off')

  _prevMessageCounts.set(convId, agent.state.messages.length)

  // Reset per-conv payloads for this new run
  _convPayloads.set(convId, [])

  // Show the user message in the UI immediately
  updateConvState(convId, { pendingUserMessage: buildUserMessage(content, images) })

  try {
    resetApiCallThrottle(convId)
    await agent.prompt(content, images.length > 0 ? images : undefined)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    updateConvState(convId, { streamError: msg, pendingUserMessage: null })
  }
}

export function abortStreaming(): void {
  const convId = get(activeConversationId)
  if (!convId) return
  const agent = _agents.get(convId)
  if (!agent) return
  agent.clearFollowUpQueue()
  updateConvState(convId, { queueLength: 0 })
  agent.abort()
}

/**
 * Remove an error assistant message (and its immediately preceding user message)
 * from agent state, the active UI, and IndexedDB.
 */
export async function deleteErrorMessage(errorMsg: AgentMessage): Promise<void> {
  const convId = get(activeConversationId)
  if (!convId) return
  if (getConvState(convId).isStreaming) return
  const agent = _agents.get(convId)
  if (!agent) return
  const msgs = agent.state.messages
  const idx = msgs.indexOf(errorMsg)
  if (idx < 0) return

  const prevIdx = idx > 0 && msgs[idx - 1].role === 'user' ? idx - 1 : -1
  const filtered = msgs.filter((_, i) => i !== idx && i !== prevIdx)

  agent.replaceMessages(filtered)
  updateConvState(convId, { messages: [...filtered] })

  await replaceAllMessages(convId, filtered)
  _prevMessageCounts.set(convId, filtered.length)
}

/**
 * Delete the error assistant message (and its preceding user message), then
 * re-send the same user content so the request is retried immediately.
 */
export async function retryFromError(errorMsg: AgentMessage): Promise<void> {
  const convId = get(activeConversationId)
  if (!convId) return
  if (getConvState(convId).isStreaming) return
  const agent = _agents.get(convId)
  if (!agent) return
  const msgs = agent.state.messages
  const idx = msgs.indexOf(errorMsg)
  if (idx < 0) return

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
 * Used by the pre-request error banner.
 */
export async function retryLastMessage(): Promise<void> {
  const convId = get(activeConversationId)
  if (!convId) return
  if (getConvState(convId).isStreaming) return
  const content = get(lastPromptContent)
  const images = get(lastPromptImages)
  if (!content && images.length === 0) return
  await sendMessage(content, images)
}

// ─── AI title generation ──────────────────────────────────────────────────────

async function maybeGenerateTitle(convId: string, minRounds: number): Promise<void> {
  const conv = get(conversations).find((c) => c.id === convId)
  if (!conv || conv.title !== '新对话') return

  const agent = _agents.get(convId)
  if (!agent) return
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
