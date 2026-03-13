/**
 * AI title generation utilities — pure functions, no store dependencies.
 * Called by chat.ts after each agent_end to auto-name conversations.
 */
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { completeSimple, type Model } from '@mariozechner/pi-ai'

/** Serialize first few user/assistant turns to plain text for the title prompt. */
export function serializeForTitle(messages: AgentMessage[]): string {
  const parts: string[] = []
  for (const m of messages) {
    const msg = m as any
    if (msg.role === 'user') {
      const text: string =
        typeof msg.content === 'string'
          ? msg.content
          : (msg.content as any[])
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text as string)
              .join('')
      if (text) parts.push(`User: ${text.slice(0, 400)}`)
    } else if (msg.role === 'assistant') {
      const texts = (msg.content as any[])
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text as string)
      if (texts.length) parts.push(`Assistant: ${texts.join('').slice(0, 400)}`)
    }
    // First 3 rounds is enough context for a title.
    if (parts.length >= 6) break
  }
  return parts.join('\n\n')
}

/** Count actual user turns in the message list. */
export function countUserMessages(messages: AgentMessage[]): number {
  return messages.filter((m) => (m as any).role === 'user').length
}

/**
 * Call the LLM to generate a short title (≤8 words) for the conversation.
 * Returns undefined on failure so the caller can ignore it silently.
 */
export async function generateAiTitle(
  messages: AgentMessage[],
  model: Model<any>,
  apiKey: string,
): Promise<string | undefined> {
  const text = serializeForTitle(messages)
  if (!text) return undefined

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
  )

  if (response.stopReason === 'error') return undefined

  const title = response.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim()
    .replace(/^["']|["']$/g, '') // strip surrounding quotes if the model added them
    .slice(0, 80)

  return title || undefined
}
