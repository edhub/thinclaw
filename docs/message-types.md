# Message Types

本文档描述 ThinClaw 中所有消息类型的字段定义、生命周期、持久化方式及在 LLM 请求中的处理方式。

---

## 一、类型全览

```
AgentMessage = UserMessage
             | AssistantMessage
             | ToolResultMessage
             | CompactionSummaryMessage   ← ThinClaw 自定义
             | MemoryUpdateMessage        ← ThinClaw 自定义
```

前三种来自 `@mariozechner/pi-ai`，后两种在 `src/lib/agent/compaction.ts` 通过 declaration merging 注入 `CustomAgentMessages`。

| role | 来源 | IDB 持久化 | 显示到 UI | `convertToLlm` 展开结果 |
|---|---|---|---|---|
| `user` | 用户输入 / `agent.prompt()` | ✅ | ✅ | 原样透传 |
| `assistant` | LLM 响应 | ✅ | ✅ | 原样透传（老 thinking block → redacted） |
| `toolResult` | 工具执行结果 | ✅ | ✅（折叠） | 原样透传 |
| `compactionSummary` | 压缩后摘要，替换旧消息 | ✅ | ❌ 过滤 | → 1 条 `user` 消息 |
| `memoryUpdate` | `memory_save` 后追加 | ✅ | ❌ 过滤 | → 2 条 `user`+`assistant` 消息 |

---

## 二、标准消息类型（来自 `@mariozechner/pi-ai`）

### UserMessage

```ts
interface UserMessage {
  role: 'user'
  content: string | (TextContent | ImageContent)[]
  timestamp: number
}
```

**content 两种形式：**
- 纯文本输入：`string`（仅存在于早期历史中，新消息总是数组形式）
- 多模态输入：`(TextContent | ImageContent)[]`

**创建时机：** `agent.prompt(text, images?)` 调用时由 agent core 创建；`@mention` 文件注入时 `<file-context>` 块 prepend 到 text 里一并发送。

---

### AssistantMessage

```ts
interface AssistantMessage {
  role: 'assistant'
  content: (TextContent | ThinkingContent | ToolCall)[]
  api: string        // e.g. 'anthropic-messages'
  provider: string   // e.g. 'anthropic'
  model: string      // e.g. 'claude-opus-4-5'
  usage: Usage
  stopReason: StopReason  // 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'
  errorMessage?: string   // 仅 stopReason === 'error' 时有值
  timestamp: number
}

interface Usage {
  input: number
  output: number
  cacheRead: number   // Anthropic: cache_read_input_tokens
  cacheWrite: number  // Anthropic: cache_creation_input_tokens
  totalTokens: number
}
```

**content block 类型：**

| type | 字段 | 说明 |
|---|---|---|
| `text` | `text: string` | 助手回复正文 |
| `thinking` | `thinking: string`, `thinkingSignature?: string`, `redacted?: boolean` | 推理过程（Claude 扩展思考）|
| `toolCall` | `id`, `name`, `arguments` | 工具调用请求 |

**thinking block 的特殊处理（见 `convertToLlm`）：**
- 最近 2 条 assistant 消息：原样传回（保留完整 thinking 文本）
- 更早的消息：
  - 有 `thinkingSignature` → 转为 redacted 形式 `{ ...block, thinking: '', redacted: true }`（Anthropic 合规紧凑格式，只传签名）
  - 无签名（如 stream 中断）→ 整个 block 丢弃

**错误消息过滤：** `convertToLlm` 会跳过 `stopReason === 'error'` 的 assistant 消息，以及其紧前方的 user 消息（整对从 LLM 上下文中排除）。

---

### ToolResultMessage

```ts
interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string   // 与 AssistantMessage 中对应 ToolCall.id 匹配
  toolName: string
  content: (TextContent | ImageContent)[]
  details?: any        // 工具自定义的结构化结果（供 UI 渲染用）
  timestamp: number
}
```

**约束：** `toolResult` 不能作为压缩切割点（`validCutPoints` 不含此 role），必须与其对应的 `toolCall` 保持在同一侧（都被摘要 or 都被保留）。

UI 中 `ToolResultMessage` 通过 `toolResultMap`（`toolCallId → ToolResultMessage`）绑定到前一条 assistant 消息内的 toolCall 气泡中渲染。

---

## 三、自定义消息类型（ThinClaw 扩展）

### CompactionSummaryMessage

```ts
interface CompactionSummaryMessage {
  role: 'compactionSummary'
  summary: string      // LLM 生成的对话摘要（Markdown）
  tokensBefore: number // 压缩前估算的 context token 数
  timestamp: number
}
```

**创建时机：** `compactMessages()` 完成后，替换被摘要的历史消息块，插在剩余消息的最前面。

**位置规则：**
- 始终是 `agent.state.messages[0]`（或 `messages` 中最多出现一次，位于最前）
- 二次压缩时旧摘要被纳入新摘要，不叠加

**`convertToLlm` 展开：**
```ts
// CompactionSummaryMessage → 1 条 user message
{
  role: 'user',
  content: [{ type: 'text', text: `[Summary of previous conversation]\n\n${cs.summary}` }],
  timestamp: cs.timestamp,
}
```

**UI：** 被 `+page.svelte` 的 `activeMessages` 过滤器过滤掉，不渲染。

---

### MemoryUpdateMessage

```ts
interface MemoryUpdateMessage {
  role: 'memoryUpdate'
  memText: string   // 格式化后的新记忆文本（仅 delta，不含历史记忆）
  timestamp: number
}
```

**创建时机：** `onAgentEnd` → `appendMemoryUpdateIfNeeded()` 检测到本轮有新的 `memory_save(tier='core')` 调用时追加（仅 delta：不在 `_convMemSnapshotIds` 且不在 `_memUpdateCoveredIds` 中的 core 记忆）。`general` 记忆不触发此追加——它们仅通过 `memory_recall` 按需检索。

**位置规则：**
- 追加在对应轮次 assistant 消息之后，位置永久固定
- 同一个 convId 内的记忆 ID 通过 `_memUpdateCoveredIds` 防止重复追加

**`convertToLlm` 展开：**
```ts
// MemoryUpdateMessage → 2 条消息（保持 user/assistant 交替格式）
{
  role: 'user',
  content: [{ type: 'text', text: `[Memory updated]\n\n${mu.memText}` }],
  timestamp: mu.timestamp,
},
{
  role: 'assistant',
  content: [{ type: 'text', text: "I've noted the memory update." }],
  timestamp: mu.timestamp,
} // 合成 ack，只用 role + content，其余字段不被 provider 层读取
```

**为什么不动态插入：** 如果每轮都重新计算最新记忆并插入，位置随对话增长而漂移，破坏 Anthropic 缓存的前缀匹配。固定位置确保上游所有消息的前缀在后续轮次中完全不变。详见 `docs/caching-and-compaction.md`。

**UI：** 被过滤，不渲染。

---

## 四、内容块类型

```ts
interface TextContent {
  type: 'text'
  text: string
  textSignature?: string  // 保留字段，Anthropic 内部使用
}

interface ThinkingContent {
  type: 'thinking'
  thinking: string
  thinkingSignature?: string  // 加密签名，Anthropic 多轮回传时需要
  redacted?: boolean          // true 时 thinking 为空，只有签名有效
}

interface ImageContent {
  type: 'image'
  data: string    // base64
  mimeType: string
}

interface ToolCall {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, any>
  thoughtSignature?: string
}
```

---

## 五、消息生命周期

```
用户输入
  └─→ agent.prompt()
        └─→ [UserMessage] 写入 agent.state.messages
              └─→ LLM 调用（convertToLlm 转换后发送）
                    └─→ [AssistantMessage] 写入 agent.state.messages
                          ├─→ 若 stopReason === 'toolUse'
                          │     └─→ [ToolResultMessage×N] 写入 agent.state.messages
                          │           └─→ 再次 LLM 调用（循环）
                          └─→ agent_end 触发
                                ├─→ persistNewMessages()        → IndexedDB
                                ├─→ appendMemoryUpdateIfNeeded()
                                │     └─→ [MemoryUpdateMessage] 追加到 agent.state.messages + IndexedDB
                                └─→ maybeCompact()
                                      └─→ 若触发：[CompactionSummaryMessage] 替换旧消息
                                                  refreshConvMemSnapshot()
```

---

## 六、持久化 vs 运行时专有

| 消息类型 | IndexedDB | agent.state.messages | LLM 请求 |
|---|---|---|---|
| `user` | ✅ | ✅ | ✅ 原样 |
| `assistant` | ✅ | ✅ | ✅（老 thinking → redacted）|
| `toolResult` | ✅ | ✅ | ✅ 原样 |
| `compactionSummary` | ✅ | ✅ | ✅ → 展开为 user |
| `memoryUpdate` | ✅ | ✅ | ✅ → 展开为 user+ack |
| memory prefix（base）| ❌ 不存储 | ❌ 不存在 | ✅ `convertToLlm` 动态注入 |

> **memory prefix** 是 `convertToLlm` 在每次 LLM 调用时从 `_convMemSnapshot` 动态构造的合成消息对，仅包含 **core 记忆**，仅存在于发往 provider 的请求中，不写入 `agent.state.messages`，也不持久化。`general` 记忆不在此列，由 AI 通过 `memory_recall` 工具按需检索。

---

## 七、相关文件

| 文件 | 职责 |
|---|---|
| `src/lib/agent/compaction.ts` | `CompactionSummaryMessage`、`MemoryUpdateMessage` 类型定义；`estimateTokens`、`toSummaryMessages` 的各 role 处理 |
| `src/lib/stores/chat.ts` | `convertToLlm`（各 role 展开规则）；`appendMemoryUpdateIfNeeded`（delta 追加）；`refreshConvMemSnapshot`（base 快照刷新）|
| `src/routes/+page.svelte` | `activeMessages` 渲染过滤（排除 `compactionSummary`、`memoryUpdate`）|
| `src/lib/components/ChatMessage.svelte` | `user`、`assistant`、`toolResult` 三种 role 的 UI 渲染 |
