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
import { writable, derived, get } from 'svelte/store';
import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core';
import type { Message } from '@mariozechner/pi-ai';
import { nanoid } from '$lib/utils/nanoid';
import { getModelById } from '$lib/models';
import { buildSystemPrompt, formatMemoriesForPrompt } from '$lib/personas';
import { soul } from '$lib/soul';
import { memories } from '$lib/stores/memory';
import { browserTools } from '$lib/tools';
import { settings } from '$lib/stores/settings';
import {
  listConversations,
  saveConversation,
  deleteConversation,
  getMessages,
  appendMessages,
  replaceAllMessages,
  type Conversation,
} from '$lib/db';
import { completeSimple, type Model } from '@mariozechner/pi-ai';
import {
  compactMessages,
  estimateContextTokens,
  shouldCompact,
  type CompactionSummaryMessage,
} from '$lib/compaction';

// ─── Singleton agent ──────────────────────────────────────────────────────────

/**
 * Convert AgentMessage[] → Message[] for the LLM.
 * Handles the built-in compactionSummary type by presenting it as a user message
 * so the LLM sees prior context without treating it as a live conversation turn.
 */
function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((m) => {
    const msg = m as any;
    if (msg.role === 'compactionSummary') {
      const cs = m as CompactionSummaryMessage;
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
      ];
    }
    if (msg.role === 'user' || msg.role === 'assistant' || msg.role === 'toolResult') {
      return [m as Message];
    }
    return [];
  });
}

let _agent: Agent | null = null;

function getAgent(): Agent {
  if (!_agent) {
    _agent = new Agent({
      initialState: {
        tools: browserTools,
        systemPrompt: '',
      },
      convertToLlm,
    });
    // Resolve api key dynamically so runtime changes are picked up
    _agent.getApiKey = async () => get(settings).apiKey || undefined;
    _agent.subscribe(handleAgentEvent);
  }
  return _agent;
}

/** Build the full system prompt from live soul + memory store + settings. */
function assembleSystemPrompt(): string {
  const s = get(settings);
  const soulContent = soul.current();
  const memText = formatMemoriesForPrompt(memories.all());
  return buildSystemPrompt(soulContent, memText, s.systemPrompt);
}

// ─── Svelte stores ────────────────────────────────────────────────────────────

export const conversations = writable<Conversation[]>([]);
export const activeConversationId = writable<string | null>(null);
export const activeMessages = writable<AgentMessage[]>([]);
export const streamingMessage = writable<AgentMessage | null>(null);
export const isStreaming = writable(false);
export const streamError = writable<string | null>(null);
/** 'compacting' while auto-compaction LLM call is in flight. */
export const compactionStatus = writable<'idle' | 'compacting'>('idle');

export const activeConversation = derived(
  [conversations, activeConversationId],
  ([$convs, $id]) => $convs.find((c) => c.id === $id) ?? null,
);

// Track how many messages existed before the current agent run
let _prevMessageCount = 0;

function handleAgentEvent(event: AgentEvent) {
  switch (event.type) {
    case 'agent_start':
      isStreaming.set(true);
      streamError.set(null);
      break;

    case 'message_update':
      if (event.message.role === 'assistant') {
        streamingMessage.set({ ...event.message });
      }
      break;

    case 'message_end':
      streamingMessage.set(null);
      activeMessages.set([...getAgent().state.messages]);
      break;

    case 'turn_end': {
      const msg = event.message as AgentMessage & { errorMessage?: string };
      if (msg.role === 'assistant' && msg.errorMessage) {
        streamError.set(msg.errorMessage);
      }
      break;
    }

    case 'agent_end':
      isStreaming.set(false);
      streamingMessage.set(null);
      activeMessages.set([...getAgent().state.messages]);
      // Fire-and-forget: persist → auto-compact (order matters)
      onAgentEnd();
      break;
  }
}

async function onAgentEnd(): Promise<void> {
  await persistNewMessages();
  await loadConversations();
  await maybeCompact();
  // Auto-title after 5 rounds (fire-and-forget, non-blocking).
  const convId = get(activeConversationId);
  if (convId) maybeGenerateTitle(convId, 5).catch(() => {});
}

async function persistNewMessages(): Promise<void> {
  const convId = get(activeConversationId);
  if (!convId) return;
  const all = getAgent().state.messages;
  const newMsgs = all.slice(_prevMessageCount);
  if (newMsgs.length === 0) return;
  await appendMessages(convId, newMsgs, _prevMessageCount);
  const conv = get(conversations).find((c) => c.id === convId);
  if (conv) {
    await saveConversation({ ...conv, updatedAt: Date.now() });
  }
  _prevMessageCount = all.length;
}

/**
 * Run auto-compaction if context is nearly full.
 * Replaces the agent's in-memory messages and syncs IndexedDB.
 * Errors are non-fatal — logged and silently ignored.
 */
async function maybeCompact(): Promise<void> {
  const agent = getAgent();
  const model = agent.state.model;
  if (!model) return;

  const messages = agent.state.messages;
  const contextTokens = estimateContextTokens(messages);
  if (!shouldCompact(contextTokens, model)) return;

  const convId = get(activeConversationId);
  const apiKey = (await agent.getApiKey?.(model.provider)) ?? '';
  if (!apiKey) return; // no key → skip silently

  compactionStatus.set('compacting');
  try {
    const result = await compactMessages(messages, model, apiKey);

    // Update in-memory agent state
    agent.replaceMessages(result.messages);
    _prevMessageCount = result.messages.length;

    // Sync IndexedDB
    if (convId) await replaceAllMessages(convId, result.messages);

    // Reflect in UI
    activeMessages.set([...result.messages]);

    console.info(
      `[compaction] ${result.tokensBefore.toLocaleString()} tokens → compacted.`,
    );
  } catch (err: unknown) {
    console.warn('[compaction] Auto-compaction failed:', err instanceof Error ? err.message : err);
  } finally {
    compactionStatus.set('idle');
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function loadConversations(): Promise<void> {
  const [list] = await Promise.all([
    listConversations(),
    memories.load(), // ensure memory store is populated at startup
  ]);
  conversations.set(list);
}

export async function selectConversation(id: string): Promise<void> {
  // Title the conversation we're leaving (if it still has the default title).
  const prevId = get(activeConversationId);
  if (prevId && prevId !== id) {
    maybeGenerateTitle(prevId, 1).catch(() => {});
  }

  const msgs = await getMessages(id);
  const agent = getAgent();
  const conv = get(conversations).find((c) => c.id === id);

  agent.setSystemPrompt(assembleSystemPrompt());
  const selectedModel = getModelById(conv?.model ?? get(settings).model);
  agent.setModel(selectedModel);
  agent.setThinkingLevel(selectedModel.reasoning ? 'medium' : 'off');
  agent.replaceMessages(msgs);

  _prevMessageCount = msgs.length;
  activeConversationId.set(id);
  activeMessages.set(msgs);
  streamingMessage.set(null);
  streamError.set(null);
}

export async function createConversation(): Promise<string> {
  const s = get(settings);
  const id = nanoid();
  const now = Date.now();
  const conv: Conversation = {
    id,
    title: 'New conversation',
    model: s.model,
    createdAt: now,
    updatedAt: now,
  };
  await saveConversation(conv);
  conversations.update((list) => [conv, ...list]);
  await selectConversation(id);
  return id;
}

export async function removeConversation(id: string): Promise<void> {
  await deleteConversation(id);
  conversations.update((list) => list.filter((c) => c.id !== id));
  activeConversationId.update((current) => {
    if (current === id) {
      getAgent().replaceMessages([]);
      _prevMessageCount = 0;
      activeMessages.set([]);
      streamingMessage.set(null);
      return null;
    }
    return current;
  });
}

export async function renameConversation(id: string, title: string): Promise<void> {
  conversations.update((list) =>
    list.map((c) => (c.id === id ? { ...c, title, updatedAt: Date.now() } : c)),
  );
  const list = await listConversations();
  const conv = list.find((c) => c.id === id);
  if (conv) await saveConversation({ ...conv, title, updatedAt: Date.now() });
}

export async function sendMessage(content: string): Promise<void> {
  const agent = getAgent();
  if (agent.state.isStreaming) return;

  const s = get(settings);
  if (!s.apiKey) {
    streamError.set('API key is not set. Please add it in Settings.');
    return;
  }

  let convId = get(activeConversationId);
  if (!convId) {
    convId = await createConversation();
  }

  // Rebuild system prompt before every message so soul/memory changes take effect
  const conv = get(conversations).find((c) => c.id === convId);
  const selectedModel = getModelById(conv?.model ?? s.model);
  agent.setSystemPrompt(assembleSystemPrompt());
  agent.setModel(selectedModel);
  agent.setThinkingLevel(selectedModel.reasoning ? 'medium' : 'off');

  _prevMessageCount = agent.state.messages.length;

  try {
    await agent.prompt(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    streamError.set(msg);
  }
}

export function abortStreaming(): void {
  getAgent().abort();
}

// ─── AI title generation ──────────────────────────────────────────────────────

/** Serialize first few user/assistant turns to plain text for the title prompt. */
function serializeForTitle(messages: AgentMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const msg = m as any;
    if (msg.role === 'user') {
      const text: string =
        typeof msg.content === 'string'
          ? msg.content
          : (msg.content as any[])
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text as string)
              .join('');
      if (text) parts.push(`User: ${text.slice(0, 400)}`);
    } else if (msg.role === 'assistant') {
      const texts = (msg.content as any[])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text as string);
      if (texts.length) parts.push(`Assistant: ${texts.join('').slice(0, 400)}`);
    }
    // First 3 rounds is enough context for a title.
    if (parts.length >= 6) break;
  }
  return parts.join('\n\n');
}

/** Count actual user turns in the message list. */
function countUserMessages(messages: AgentMessage[]): number {
  return messages.filter((m) => (m as any).role === 'user').length;
}

/**
 * Call the LLM to generate a short title (≤8 words) for the conversation.
 * Returns undefined on failure so the caller can ignore it silently.
 */
async function generateAiTitle(
  messages: AgentMessage[],
  model: Model<any>,
  apiKey: string,
): Promise<string | undefined> {
  const text = serializeForTitle(messages);
  if (!text) return undefined;

  const response = await completeSimple(
    model,
    {
      systemPrompt:
        'You are a conversation title generator. ' +
        'Output ONLY a short title (5–8 words max) that captures the main topic. ' +
        'No quotes, no trailing punctuation, no explanations.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: `Generate a title for this conversation:\n\n${text}` }],
          timestamp: Date.now(),
        },
      ],
    },
    { maxTokens: 50, apiKey },
  );

  if (response.stopReason === 'error') return undefined;

  const title = response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim()
    .replace(/^["']|["']$/g, '') // strip surrounding quotes if the model added them
    .slice(0, 80);

  return title || undefined;
}

/**
 * Generate an AI title for a conversation if:
 *   - The title is still the default 'New conversation' (never been titled).
 *   - The user has sent at least `minRounds` messages.
 *
 * minRounds=5  → triggered after 5 back-and-forths
 * minRounds=1  → triggered on conversation switch (any content)
 */
async function maybeGenerateTitle(convId: string, minRounds: number): Promise<void> {
  const conv = get(conversations).find((c) => c.id === convId);
  // Skip if already titled.
  if (!conv || conv.title !== 'New conversation') return;

  const agent = getAgent();
  const messages = agent.state.messages;
  if (countUserMessages(messages) < minRounds) return;

  const model = agent.state.model;
  if (!model) return;
  const apiKey = (await agent.getApiKey?.(model.provider)) ?? '';
  if (!apiKey) return;

  try {
    const title = await generateAiTitle(messages, model, apiKey);
    if (title) await renameConversation(convId, title);
  } catch (err) {
    console.warn('[auto-title] Failed to generate title:', err instanceof Error ? err.message : err);
  }
}
