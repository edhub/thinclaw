/**
 * Chat store — manages active conversation state and streaming.
 */
import { writable, derived } from 'svelte/store';
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { nanoid } from '$lib/utils/nanoid';
import {
  listConversations,
  saveConversation,
  getMessages,
  saveMessage,
  updateMessageContent,
  deleteConversation,
  type Conversation,
  type Message,
} from '$lib/db';

// --- State ---

export const conversations = writable<Conversation[]>([]);
export const activeConversationId = writable<string | null>(null);
export const activeMessages = writable<Message[]>([]);
export const isStreaming = writable(false);
export const streamError = writable<string | null>(null);

export const activeConversation = derived(
  [conversations, activeConversationId],
  ([$convs, $id]) => $convs.find((c) => c.id === $id) ?? null,
);

// --- Load ---

export async function loadConversations(): Promise<void> {
  const list = await listConversations();
  conversations.set(list);
}

export async function selectConversation(id: string): Promise<void> {
  activeConversationId.set(id);
  const msgs = await getMessages(id);
  activeMessages.set(msgs);
  streamError.set(null);
}

// --- Create / Delete ---

export async function createConversation(model: string): Promise<string> {
  const id = nanoid();
  const now = Date.now();
  const conv: Conversation = {
    id,
    title: 'New conversation',
    model,
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
  // If removed conv was active, clear state
  activeConversationId.update((current) => {
    if (current === id) {
      activeMessages.set([]);
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

// --- Send message ---

export async function sendMessage(params: {
  content: string;
  conversationId: string;
  model: string;
  apiKey: string;
  systemPrompt: string;
}): Promise<void> {
  const { content, conversationId, model, apiKey, systemPrompt } = params;

  if (!apiKey) {
    streamError.set('API key is not set. Please add it in Settings.');
    return;
  }

  // Persist user message
  const userMsg: Message = {
    id: nanoid(),
    conversationId,
    role: 'user',
    content,
    createdAt: Date.now(),
  };
  await saveMessage(userMsg);
  activeMessages.update((msgs) => [...msgs, userMsg]);

  // Placeholder for assistant reply
  const assistantMsgId = nanoid();
  const assistantMsg: Message = {
    id: assistantMsgId,
    conversationId,
    role: 'assistant',
    content: '',
    createdAt: Date.now() + 1,
  };
  activeMessages.update((msgs) => [...msgs, assistantMsg]);

  isStreaming.set(true);
  streamError.set(null);

  // Build message history for the API call
  const history = await getMessages(conversationId);
  // history already includes the user message we just saved
  const apiMessages = history
    .filter((m) => m.id !== assistantMsgId)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const openai = createOpenAI({ apiKey });
    const result = streamText({
      model: openai(model),
      system: systemPrompt,
      messages: apiMessages,
    });

    let accumulated = '';
    for await (const delta of result.textStream) {
      accumulated += delta;
      activeMessages.update((msgs) =>
        msgs.map((m) => (m.id === assistantMsgId ? { ...m, content: accumulated } : m)),
      );
    }

    // Persist final assistant message
    await saveMessage({ ...assistantMsg, content: accumulated });

    // Auto-title: use first 60 chars of first user message if still default
    await maybeAutoTitle(conversationId, content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    streamError.set(msg);
    // Remove empty assistant placeholder on error
    activeMessages.update((msgs) => msgs.filter((m) => m.id !== assistantMsgId));
  } finally {
    isStreaming.set(false);
    // Refresh conversation list to update updatedAt ordering
    await loadConversations();
  }
}

async function maybeAutoTitle(conversationId: string, firstUserContent: string): Promise<void> {
  const list = await listConversations();
  const conv = list.find((c) => c.id === conversationId);
  if (!conv || conv.title !== 'New conversation') return;
  const title = firstUserContent.trim().slice(0, 60) || 'New conversation';
  await saveConversation({ ...conv, title, updatedAt: Date.now() });
  conversations.update((cs) =>
    cs.map((c) => (c.id === conversationId ? { ...c, title, updatedAt: Date.now() } : c)),
  );
}
