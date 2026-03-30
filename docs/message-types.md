# Message Types

本文档描述 ThinClaw 中所有消息类型的字段定义、生命周期、持久化方式及在 LLM 请求中的处理方式。

---

## 一、类型全览

```
AgentMessage = UserMessage
             | AssistantMessage
             | ToolResultMessage
             | CompactionSummaryMessage   ← 遗留 schema 类型（见下）
```

前三种来自 `@mariozechner/pi-ai`，`CompactionSummaryMessage` 是 ThinClaw 的自定义扩展类型，
通过 `@mariozechner/pi-agent-core` 提供的 `CustomAgentMessages` declaration merging 接口注入。

> **注意：** `CompactionSummaryMessage` 是一个**遗留 schema 类型**。它可能出现在早期版本写入
> IndexedDB 的历史记录中，UI 代码对其做了防御性处理（过滤显示、在 SessionViewer 中打标签）。
> 当前代码**不会主动生成**此类型的消息——自动压缩功能已从运行时中移除。

| role | 来源 | IDB 持久化 | 显示到 UI | LLM 请求处理 |
|---|---|---|---|---|
| `user` | 用户输入 / `agent.prompt()` | ✅ | ✅ | 原样透传 |
| `assistant` | LLM 响应 | ✅ | ✅ | 原样透传（老 thinking block → redacted） |
| `toolResult` | 工具执行结果 | ✅ | ✅（折叠） | 原样透传 |
| `compactionSummary` | 遗留类型，不再主动写入 | ✅（存量） | ❌ 过滤 | → 展开为 1 条 `user` 消息 |

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
  provider: string   // e.g. 'bianxie'
  model: string      // e.g. 'claude-sonnet-4-6'
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

**thinking block 的处理（pi-agent-core 内置 `convertToLlm`）：**
- 最近 3 个 user turn 内的 assistant 消息：原样传回（保留完整 thinking 文本）
- 更早的消息：
  - 有 `thinkingSignature` → 转为 redacted 形式 `{ ...block, thinking: '', redacted: true }`（Anthropic 合规紧凑格式，只传签名）
  - 无签名（如 stream 中断）→ 整个 block 丢弃

**错误消息过滤：** pi-agent-core 默认的 `convertToLlm` 会跳过 `stopReason === 'error'` 的 assistant 消息，以及其紧前方的 user 消息（整对从 LLM 上下文中排除）。

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

UI 中 `ToolResultMessage` 通过 `toolResultMap`（`toolCallId → ToolResultMessage`）绑定到前一条 assistant 消息内的 toolCall 气泡中渲染。

---

## 三、遗留自定义消息类型

### CompactionSummaryMessage

```ts
interface CompactionSummaryMessage {
  role: 'compactionSummary'
  summary: string      // LLM 生成的对话摘要（Markdown）
  tokensBefore: number // 压缩前估算的 context token 数
  timestamp: number
}
```

**历史背景：** 早期版本的 ThinClaw 实现了自动对话压缩功能——当上下文超出阈值时，使用 utility model 生成摘要并替换历史消息，生成的 `CompactionSummaryMessage` 写入 agent state 和 IndexedDB。该功能已从当前版本移除，但类型定义和 UI 防御逻辑保留，以兼容可能存在的老版本存量数据。

**当前行为：**
- 读取时：`+page.svelte` 的 `activeMessages` 过滤器过滤掉此类型不渲染；SessionViewer 将其标记为 `compaction` badge 显示
- 写入时：**不再主动写入**，当前运行时不会产生新的 `compactionSummary` 消息
- LLM 请求时：若存量记录中存在此类型，pi-agent-core 会将其展开为一条 `user` 消息：
  ```ts
  { role: 'user', content: [{ type: 'text', text: `[Summary of previous conversation]\n\n${cs.summary}` }] }
  ```

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
              └─→ LLM 调用（pi-agent-core 内置 convertToLlm 转换后发送）
                    └─→ [AssistantMessage] 写入 agent.state.messages
                          ├─→ 若 stopReason === 'toolUse'
                          │     └─→ [ToolResultMessage×N] 写入 agent.state.messages
                          │           └─→ 再次 LLM 调用（循环）
                          └─→ agent_end 触发
                                └─→ persistNewMessages()  → IndexedDB
```

---

## 六、持久化 vs 运行时

| 消息类型 | IndexedDB | agent.state.messages | LLM 请求 |
|---|---|---|---|
| `user` | ✅ | ✅ | ✅ 原样 |
| `assistant` | ✅ | ✅ | ✅（老 thinking → redacted）|
| `toolResult` | ✅ | ✅ | ✅ 原样 |
| `compactionSummary` | ✅（存量只读）| ✅（若从 IDB 加载）| ✅ → 展开为 user |

> **记忆（Memories）** 不作为消息存在。它们通过 `assembleSystemPrompt()` 注入为最后一段 system prompt，每次 `sendMessage()` 前重建。详见 `docs/caching-and-compaction.md`。

---

## 七、相关文件

| 文件 | 职责 |
|---|---|
| `src/lib/stores/chat.ts` | `assembleSystemPrompt()`、`sendMessage()`、`persistNewMessages()`、Agent 生命周期 |
| `src/routes/+page.svelte` | `activeMessages` 渲染过滤（排除 `compactionSummary`）|
| `src/lib/components/ChatMessage.svelte` | `user`、`assistant`、`toolResult` 三种 role 的 UI 渲染 |
| `src/lib/components/SessionViewer.svelte` | 所有 role 的调试视图，含 `compactionSummary` badge |
| `src/lib/db/index.ts` | IndexedDB schema + 读写操作；`replaceAllMessages` 供未来压缩功能使用 |
