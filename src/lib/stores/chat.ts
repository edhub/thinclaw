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
import type { AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core'
import type { ImageContent, Message } from '@mariozechner/pi-ai'
import { nanoid } from '$lib/utils/nanoid'
import { getModelById, DEFAULT_UTILITY_MODEL_ID } from '$lib/agent/models'
import { buildSystemPrompt, formatMemoriesForPrompt } from '$lib/agent/prompts'
import { getPersonaById } from '$lib/agent/personas'
import { soul } from '$lib/agent/soul'
import { memories } from '$lib/stores/memory'
import { browserTools } from '$lib/agent/tools'
import { settings } from '$lib/stores/settings'
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
  type CompactionSummaryMessage,
} from '$lib/agent/compaction'
import { recordSession, updateSessionTitle, sweepSessions } from '$lib/fs/session-recorder'

// ─── Singleton agent ──────────────────────────────────────────────────────────

/** Return the utility model used for background tasks (compaction, auto-title). */
function getUtilityModel() {
  return getModelById(DEFAULT_UTILITY_MODEL_ID)
}

/**
 * Convert AgentMessage[] → Message[] for the LLM.
 * Handles the built-in compactionSummary type by presenting it as a user message
 * so the LLM sees prior context without treating it as a live conversation turn.
 */
function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((m) => {
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
    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'toolResult') {
      return [m as Message]
    }
    return []
  })
}

let _agent: Agent | null = null

function getAgent(): Agent {
  if (!_agent) {
    _agent = new Agent({
      initialState: {
        tools: browserTools,
        systemPrompt: '',
      },
      convertToLlm,
    })
    // Resolve api key dynamically so runtime changes are picked up
    _agent.getApiKey = async () => get(settings).apiKey || undefined
    _agent.subscribe(handleAgentEvent)
  }
  return _agent
}

/** Build the full system prompt from live soul + persona + memory store + settings. */
function assembleSystemPrompt(convId?: string): string {
  const s = get(settings)
  const soulContent = soul.current()
  const memText = formatMemoriesForPrompt(memories.all())
  const id = convId ?? get(activeConversationId)
  const conv = get(conversations).find((c) => c.id === id)
  const persona = conv?.personaId ? getPersonaById(conv.personaId) : undefined
  return buildSystemPrompt(soulContent, memText, s.systemPrompt, persona?.content)
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

export const activeConversation = derived(
  [conversations, activeConversationId],
  ([$convs, $id]) => $convs.find((c) => c.id === $id) ?? null,
)

// Per-conversation message count before the current agent run.
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
        streamingMessage.set({ ...event.message })
      }
      break

    case 'message_end':
      streamingMessage.set(null)
      activeMessages.set([...getAgent().state.messages])
      // User message is now in agent.state.messages — clear the optimistic placeholder.
      pendingUserMessage.set(null)
      // If this was a queued follow-up user message, decrement the counter.
      if ((event.message as any).role === 'user') {
        queueLength.update((n) => (n > 0 ? n - 1 : 0))
      }
      break

    case 'turn_end': {
      const msg = event.message as AgentMessage & { errorMessage?: string }
      if (msg.role === 'assistant' && msg.errorMessage) {
        streamError.set(msg.errorMessage)
      }
      break
    }

    case 'agent_end':
      isStreaming.set(false)
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
  await recordSession(
    convId,
    title,
    createdAt,
    model,
    thinkingLevel,
    conv?.personaId,
    systemPrompt,
    messages,
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
 * Run auto-compaction if context is nearly full.
 * Replaces the agent's in-memory messages and syncs IndexedDB.
 * Errors are non-fatal — logged and silently ignored.
 *
 * Race condition guard: if the user switches conversations during the LLM
 * summarisation call, the IDB update still applies to the correct conversation
 * but in-memory state / UI updates are skipped to avoid clobbering the new
 * conversation's agent state.
 */
async function maybeCompact(): Promise<void> {
  const agent = getAgent()
  const mainModel = agent.state.model
  if (!mainModel) return

  const messages = agent.state.messages
  const contextTokens = estimateContextTokens(messages)
  // Decide whether to compact based on the main model's context window.
  if (!shouldCompact(contextTokens, mainModel)) return

  const convId = get(activeConversationId)
  // Use the utility model to perform the actual summarisation.
  const utilityModel = getUtilityModel()
  const apiKey = (await agent.getApiKey?.(utilityModel.provider)) ?? ''
  if (!apiKey) return // no key → skip silently

  compactionStatus.set('compacting')
  try {
    const result = await compactMessages(messages, utilityModel, apiKey)

    // Always write the compacted history to IDB for the originating conversation.
    if (convId) await replaceAllMessages(convId, result.messages)

    // If the user switched away during the (slow) LLM summarisation call,
    // don't touch the agent state or UI — they now belong to a different conversation.
    if (get(activeConversationId) !== convId) {
      console.info(
        '[compaction] conversation switched during compaction; IDB updated, in-memory state skipped.',
      )
      return
    }

    // Update in-memory agent state
    agent.replaceMessages(result.messages)
    if (convId) _prevMessageCounts.set(convId, result.messages.length)

    // Reflect in UI
    activeMessages.set([...result.messages])

    console.info(`[compaction] ${result.tokensBefore.toLocaleString()} tokens → compacted.`)
  } catch (err: unknown) {
    console.warn('[compaction] Auto-compaction failed:', err instanceof Error ? err.message : err)
  } finally {
    compactionStatus.set('idle')
  }
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
  const selectedModel = getModelById(get(settings).model)
  agent.setModel(selectedModel)
  agent.setThinkingLevel(selectedModel.reasoning ? 'medium' : 'off')
  agent.replaceMessages(msgs)

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

export async function sendMessage(content: string, images: ImageContent[] = []): Promise<void> {
  const agent = getAgent()

  const s = get(settings)
  if (!s.apiKey) {
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
  const selectedModel = getModelById(s.model)
  agent.setSystemPrompt(assembleSystemPrompt())
  agent.setModel(selectedModel)
  agent.setThinkingLevel(selectedModel.reasoning ? 'medium' : 'off')

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
