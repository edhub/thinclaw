/**
 * Chat store — manages conversation state using @mariozechner/pi-agent-core Agent.
 *
 * Architecture:
 * - Singleton Agent instance, reconfigured per conversation via replaceMessages()
 * - Agent events → Svelte writables → reactive UI
 * - After agent_end, new messages are persisted to IndexedDB
 */
import { writable, derived, get } from 'svelte/store';
import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core';
import { nanoid } from '$lib/utils/nanoid';
import { getModelById } from '$lib/models';
import { buildSystemPrompt } from '$lib/personas';
import { browserTools } from '$lib/tools';
import { settings } from '$lib/stores/settings';
import {
  listConversations,
  saveConversation,
  deleteConversation,
  getMessages,
  appendMessages,
  type Conversation,
} from '$lib/db';

// --- Singleton agent ---

let _agent: Agent | null = null;

function getAgent(): Agent {
  if (!_agent) {
    _agent = new Agent({
      initialState: {
        tools: browserTools,
        systemPrompt: '',
      },
    });
    // Resolve api key dynamically so runtime changes are picked up
    _agent.getApiKey = async () => get(settings).apiKey || undefined;
    _agent.subscribe(handleAgentEvent);
  }
  return _agent;
}

// --- Svelte stores ---

export const conversations = writable<Conversation[]>([]);
export const activeConversationId = writable<string | null>(null);
export const activeMessages = writable<AgentMessage[]>([]);
export const streamingMessage = writable<AgentMessage | null>(null);
export const isStreaming = writable(false);
export const streamError = writable<string | null>(null);

export const activeConversation = derived(
  [conversations, activeConversationId],
  ([$convs, $id]) => $convs.find((c) => c.id === $id) ?? null,
);

// Track how many messages existed before the current agent run
// so we know which are new and need persisting
let _prevMessageCount = 0;

function handleAgentEvent(event: AgentEvent) {
  switch (event.type) {
    case 'agent_start':
      isStreaming.set(true);
      streamError.set(null);
      break;

    case 'message_update':
      // Only show streaming for assistant messages
      if (event.message.role === 'assistant') {
        streamingMessage.set({ ...event.message });
      }
      break;

    case 'message_end':
      // Completed message is now in agent.state.messages — sync the store
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
      // Persist only the messages added during this run
      persistNewMessages();
      // Refresh conversation list to update updatedAt ordering
      loadConversations();
      break;
  }
}

async function persistNewMessages(): Promise<void> {
  const convId = get(activeConversationId);
  if (!convId) return;
  const all = getAgent().state.messages;
  const newMsgs = all.slice(_prevMessageCount);
  if (newMsgs.length === 0) return;
  await appendMessages(convId, newMsgs, _prevMessageCount);
  // Update conversation updatedAt
  const conv = get(conversations).find((c) => c.id === convId);
  if (conv) {
    const updated = { ...conv, updatedAt: Date.now() };
    await saveConversation(updated);
  }
  _prevMessageCount = all.length;
}

// --- Public API ---

export async function loadConversations(): Promise<void> {
  const list = await listConversations();
  conversations.set(list);
}

export async function selectConversation(id: string): Promise<void> {
  const msgs = await getMessages(id);
  const agent = getAgent();
  const s = get(settings);

  // Reconfigure agent for this conversation
  const conv = get(conversations).find((c) => c.id === id);
  const personaId = conv?.personaId ?? s.personaId;
  agent.setSystemPrompt(buildSystemPrompt(personaId, s.systemPrompt));
  agent.setModel(getModelById(conv?.model ?? s.model));
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
    personaId: s.personaId,
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
      // Clear agent state
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

  // Reconfigure model / system prompt in case settings changed since last send
  const conv = get(conversations).find((c) => c.id === convId);
  const personaId = conv?.personaId ?? s.personaId;
  agent.setSystemPrompt(buildSystemPrompt(personaId, s.systemPrompt));
  agent.setModel(getModelById(conv?.model ?? s.model));

  _prevMessageCount = agent.state.messages.length;

  try {
    await agent.prompt(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    streamError.set(msg);
  }

  // Auto-title from first user message
  await maybeAutoTitle(convId, content);
}

export function abortStreaming(): void {
  getAgent().abort();
}

async function maybeAutoTitle(conversationId: string, firstUserContent: string): Promise<void> {
  const list = await listConversations();
  const conv = list.find((c) => c.id === conversationId);
  if (!conv || conv.title !== 'New conversation') return;
  const title = firstUserContent.trim().slice(0, 60) || 'New conversation';
  const updated = { ...conv, title, updatedAt: Date.now() };
  await saveConversation(updated);
  conversations.update((cs) =>
    cs.map((c) => (c.id === conversationId ? updated : c)),
  );
}
