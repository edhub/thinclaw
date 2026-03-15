# Caching & Compaction Strategy

本文档记录 ThinClaw 在 AI provider 缓存利用、thinking block 处理以及对话压缩三个方面的设计决策与实现细节。

---

## 一、Provider 缓存机制对比

### 1. Anthropic（Claude）— 显式缓存，需要客户端标记

**工作原理：**  
客户端必须在请求体中通过 `cache_control: { type: "ephemeral" }` 手动标记缓存断点。服务端缓存该断点之前的所有 token 前缀。

`pi-ai` 的 `anthropic.js` provider 自动在两个位置打断点：
1. **System prompt 末尾** — 缓存整个系统提示
2. **最后一条 user message 末尾** — 缓存对话历史

**TTL：**
| 条件 | TTL |
|---|---|
| 默认（`ephemeral`） | **5 分钟** |
| `cacheRetention: "long"` + `baseUrl` 含 `api.anthropic.com` | **1 小时** |

> ⚠️ bianxie.ai / laozhang.ai 均为代理，不满足 `api.anthropic.com` 条件，**1 小时 TTL 无法启用**，硬上限为 5 分钟。

**缓存费率（相对于标准 input token）：**
- Cache write：约 1.25× input cost
- Cache read：约 0.1× input cost（节省 90%）

---

### 2. OpenAI — 全自动，无需客户端操作

**工作原理：**  
完全服务端自动。OpenAI 检测相同前缀的重复请求并透明地复用缓存，客户端无需任何标记。

**TTL：约 1 小时**（显著优于 Anthropic 的 5 分钟）

**如何读取命中数据：**
```js
// openai-completions.js
const cachedTokens = chunk.usage.prompt_tokens_details?.cached_tokens || 0;
```

**结论：只需保持 system prompt 稳定，自然受益，无需额外实现。**

---

### 3. Google Gemini — 隐式缓存为主，显式缓存未实现

**两种缓存模式：**

| 模式 | 触发方式 | TTL | 实现状态 |
|---|---|---|---|
| **隐式缓存**（Implicit Caching） | 服务端自动，检测重复前缀 | 较短（由 Google 决定） | ✅ 自动生效 |
| **显式缓存**（CachedContent API） | 客户端预先创建缓存资源 | 最短 1 小时，需 ≥32k token | ❌ 未实现 |

**如何读取命中数据：**
```js
// google.js
cacheRead: chunk.usageMetadata.cachedContentTokenCount || 0,
cacheWrite: 0,  // 硬编码为 0，Google provider 不上报 write
```

**显式缓存未实现的原因：**  
需要独立 API 调用预创建 `CachedContent` 资源，最低门槛 32k token，实现复杂度高，收益有限，暂不引入。

---

## 二、System Prompt 稳定化（Anthropic 缓存命中率核心）

### 问题根因

`assembleSystemPrompt()` 在**每次** `sendMessage()` 前重建，其中包含从 IndexedDB 读取的 memory：

```ts
// 旧逻辑（有问题）
const memText = formatMemoriesForPrompt(memories.all())
return buildSystemPrompt(soulContent, memText, ...)
// → memory 变化 → system prompt 变化 → cache miss → 写新缓存 → 恶性循环
```

Agent 被明确指示频繁调用 `memory_save`，导致几乎每轮都触发 cache miss。

### 解决方案：将 Memory 移出 System Prompt

**`assembleSystemPrompt()`（`chat.ts`）** — 不再传入 memory：
```ts
// 新逻辑：system prompt 只含稳定内容
return buildSystemPrompt(soulContent, '', s.systemPrompt, persona?.content)
```

**`convertToLlm()`（`chat.ts`）** — 在对话历史开头注入合成消息对：
```ts
const memPrefix: Message[] = [
  {
    role: 'user',
    content: [{ type: 'text', text: `[Your memories from previous conversations]\n\n${memText}` }],
    timestamp: 0,
  },
  {
    role: 'assistant',
    content: [{ type: 'text', text: 'I have reviewed my memories...' }],
    timestamp: 0,
  } as unknown as Message,
]
return [...memPrefix, ...converted]
```

**效果：**
- System prompt = Soul + Persona + Instructions → **请求间字节级完全相同** → Anthropic 每轮必命中缓存
- Memory 变化只影响对话历史的第一个 cache breakpoint，不破坏 system prompt 缓存
- 合成消息对仅存在于发往 LLM 的请求中，不写入 `agent.state.messages`，对 IndexedDB / 会话录制透明
- 对 OpenAI / Google 同样有益：稳定前缀 → 更高的自动缓存命中率

### 对话历史缓存的前缀稳定性

Anthropic 在每条请求的**最后一条 user message** 上同样打 `cache_control`，缓存从头到该位置的完整前缀。这意味着下一轮请求可以复用上一轮缓存的前缀，只需计算新增的 assistant + user 内容：

```
Turn N   缓存: [mem] + [turn1] + ... + [turnN ← cache_control]
Turn N+1 发送: [mem] + [turn1] + ... + [turnN] + [assistantN] + [turnN+1 ← cache_control]
              └─────────── 命中 Turn N 的缓存 ───────────┘ └── 全价 ──┘
```

**双层注入策略（append-only，不破坏缓存）：**

| 注入 | 位置 | 内容 | 稳定性 |
|---|---|---|---|
| **Base**（`_convMemSnapshot`） | 对话历史最前面（位置 0）| 会话开始时的全量 **core** 记忆 | 整个会话期间不变 ✓ |
| **Delta**（`MemoryUpdateMessage`） | `memory_save` 被调用的 turn 结束后，追加到历史末尾 | 该 turn 新存的 **core** 记忆（delta only）| 一旦追加位置永远固定 ✓ |

```
Turn 3 调用了 memory_save("C"):
  [base: A,B] [ack]                       ← 位置 0，整个会话不变
  [u1][a1][u2][a2][u3][a3-with-tool]
  [MemoryUpdate: C] [ack]                 ← 追加在 turn 3 之后，永久固定
  [u4 ← cache_control]

Turn 5 (无新记忆):
  [base: A,B] [ack]                       ← 完全相同 ✓
  [u1][a1][u2][a2][u3][a3-with-tool]
  [MemoryUpdate: C] [ack]                 ← 完全相同 ✓（不是重新计算的！）
  [u4][a4][u5 ← cache_control]
  → 命中 Turn 4 的缓存 ✓
```

> **为什么不能把 delta "每次动态插入到当前 turn 前"：**  
> 动态浮动插入意味着每个 turn delta 的位置会变（turn N 插在 userN 前，turn N+1 插在 userN+1 前），导致每次前缀结构都不同，缓存完全失效。只有让 delta 在历史中**固定住**才能保证缓存稳定。

**`_convMemSnapshot` 刷新时机：**
- `selectConversation` 时（加载/切换到一个会话）
- `runCompaction` 后（旧 MemoryUpdateMessage 已被压缩进摘要，新 base 包含所有历史 core 记忆）

**`MemoryUpdateMessage` 的生命周期：**
`onAgentEnd` 后检测新记忆 → 追加到 `agent.state.messages` → 持久化到 IndexedDB → `convertToLlm` 展开为 user/assistant 对 → 压缩时被纳入摘要 → `refreshConvMemSnapshot()` 将其内容并入新 base。

---

### 工具调用产生的额外缓存写

`anthropic.js` 在每次 LLM 调用时，把 `cache_control` 打在"最后一条 user 消息的最后一个 block"上。由于 `toolResult` 在发送给 Anthropic 时会被转为 `role: "user"` 的 `tool_result` block，**任何一次工具调用都会产生 2 次 LLM 请求，从而产生 2 个缓存断点**：

```
Turn N-1 结束时已缓存：[sys] [core-mem][ack] [history] [user_{N-1} ← checkpoint①]

Call #1 of Turn N：
  cache_read       = [sys...user_{N-1}]           ← 命中 checkpoint①
  cache_creation   = [user_N]                     ← 仅新增 token → checkpoint②

Call #2 of Turn N（工具结果回传）：
  cache_read       = [sys...user_N]               ← 自动命中 checkpoint②
  cache_creation   = [assistant-toolCall + toolResult_N]  ← 仅新增 token → checkpoint③
```

#### `onPayload` hook — 稳定缓存层

ThinClaw 通过 Agent 的 `onPayload` hook 在 Anthropic 请求发送前注入缓存断点。
策略是**只缓存稳定不变的前缀**（system + tools），不在易变的消息历史上加断点：

| 断点 | 约 tokens | 来源 | 稳定性 |
|---|---|---|---|
| ① | ~600 | System prompt 末尾（pi-ai 内置） | 永远不变，但低于 Anthropic 1,024 最低阈值，不生效 |
| ② | ~3,500 | 最后一个 tool 定义（`onPayload` hook） | **永远不变 ✓ — 真正的稳定缓存层** |
| ③ | 变化 | 最后一条 user 消息（pi-ai 内置） | 跨 turn 前沿，有助于连续对话复用 |

```
每次 LLM 调用：
  [sys ← cc①(no-op)] [tools ← cc②] [...history...] [last_user ← cc③]
                       ↑ ~3,500 tokens 永远命中
```

**效果：** 无论对话内容如何变化，`system + tools` 前缀（~3,500 tokens）始终从缓存读取。
消息历史部分由 pi-ai 的 last-user 断点 ③ 提供跨 turn 的增量缓存。

**为什么不在中间 user 消息上加断点：** pi-ai 会在每次调用时将 `cache_control` 打在最后一条
user 消息上。tool call 后 `tool_result` 变成新的 "最后一条 user"，导致前一条 user 消息
失去 `cache_control`，序列化字节变化，破坏前缀匹配。虽然可以通过在倒数第二条 user 上
补加断点来修复，但通过 bianxie 代理时由于多账号路由问题，这种精细优化不可靠。
只保留 tools 断点更简单且收益确定。

**实现位置：** `src/lib/stores/chat.ts` → `onAnthropicPayload()`

#### 已知限制：bianxie 多账号路由（2026-03 实测）

bianxie.ai 代理在至少 2 个 Anthropic 账号间做负载均衡。Anthropic 的 prompt cache
是**按账号隔离**的，不同账号之间的缓存无法共用。

**证据：** 一次 6-turn 纯文字对话（无 tool call）的缓存数据：

| Turn | cacheRead | cacheWrite | 分析 |
|------|-----------|------------|------|
| 1 "早～" | 3,598 | 0 | 跨 session 命中（前一个 session 写入的 3,598） |
| 2 "我来给你打招呼" | **0** | 3,644 | ❌ 全部 miss |
| 3 "今天天气很好" | **3,598** | 110 | ✅ 命中，但读的是 **3,598**（Turn 1 的值）不是 3,644（Turn 2 的值） |
| 4 "我昨天睡的很香" | **0** | 3,788 | ❌ 全部 miss |
| 5 "你睡觉吗？" | **3,708** | 153 | ✅ 命中（3,708 = Turn 3 的 3,598 + 110） |
| 6 "适合去上班的…" | **3,861** | 120 | ✅ 命中（3,861 = Turn 5 的 3,708 + 153） |

关键证据：**Turn 3 读到的是 3,598（Turn 1 写入的值），不是 3,644（Turn 2 写入的值）。**
这只有在 Turn 1 和 Turn 3 路由到同一账号（A），Turn 2 路由到另一账号（B）时才能解释。

缓存链条追踪：
- **账号 A**：Turn 1(read 3,598) → Turn 3(read 3,598 + write 110) → Turn 5(read 3,708 + write 153) → Turn 6(read 3,861)
- **账号 B**：Turn 2(write 3,644) → Turn 4(write 3,788，Turn 2 缓存因 thinking→redacted 变化而失效)

**影响：** tools 级缓存（~3,500 tokens）在同一账号上始终命中，但跨账号请求会重写。
ThinClaw 无法控制路由策略，只能确保缓存断点设置正确以最大化同账号命中率。
直连 Anthropic API 时此问题不存在。

---

## 三、Thinking Block 处理

### Anthropic 的要求

官方文档要求：多轮对话中必须把所有历史 thinking block **原样传回**，因为它们带有加密签名（`thinkingSignature`），是不可篡改的载体。

### 旧实现的问题

```ts
// 旧逻辑：直接过滤掉老 thinking block（违反 Anthropic 协议）
const stripped = {
  ...msg,
  content: (msg.content ?? []).filter((b: any) => b.type !== 'thinking')
}
```

超出最近 2 条的 assistant 消息，其 thinking block 被整个删除。Anthropic 收到没有 thinking block 的 assistant 消息，可能导致：
- 严格模式下触发 API 报错
- 模型推理连贯性受损（模型看到自己"说过的话"但没有对应思考过程）

### 修复：转为 Redacted 形式

```ts
// 新逻辑：保留签名，清空内容，转为 redacted 形式
const content = (msg.content ?? []).flatMap((b: any) => {
  if (b.type !== 'thinking') return [b]
  if (b.thinkingSignature?.trim()) {
    // 保留签名，丢弃思考文本，节省 token
    return [{ ...b, thinking: '', redacted: true }]
  }
  // 无签名（如 aborted stream）→ 整个丢弃，避免 API 报错
  return []
})
```

`anthropic.js` 看到 `redacted: true` 时发送：
```json
{ "type": "redacted_thinking", "data": "<thinkingSignature>" }
```

这是 Anthropic 官方支持的紧凑格式：**只传签名（opaque payload），不传思考文本**，完全合规，token 消耗极小。

### 缓存影响：thinking → redacted 转换破坏前缀

Thinking block 从完整形式 `{type:"thinking", thinking:"...", signature:"..."}` 转为
redacted 形式 `{type:"redacted_thinking", data:"..."}` 会改变消息的序列化字节。如果这个
转换发生在 Anthropic 已缓存的前缀范围内，会导致**前缀不匹配，缓存全量重写**。

**策略：3-turn buffer.** 保留最近 3 个 user turn 内的 thinking block 原始形式，只对更早的
block 做 redact。这样连续两次 LLM 调用之间，前缀中的 thinking block 表示形式不变。
3 turns 之外的 redact 虽然仍会导致该位置的前缀变化，但此时 `system + tools` 的
稳定缓存层（~3,500 tokens）仍然命中。

```ts
// chat.ts → convertToLlm
const keepThinkingFromIdx = userIndices.length >= 3
  ? userIndices[userIndices.length - 3]  // 3-turn buffer
  : 0                                     // 短对话全部保留
```

### 各 Provider 的兼容性

| Provider | 行为 | 说明 |
|---|---|---|
| Anthropic | 发送 `redacted_thinking` 块 | ✅ 合规省 token |
| Google | `thinking: ''` → `google-shared.js` 直接跳过空 thinking block | ✅ 无害 |
| OpenAI | `thinking: ''` → `openai-completions.js` 过滤空 thinking block | ✅ 无害 |

---

## 四、对话压缩（Compaction）策略

压缩逻辑分布在**两个时机**，分别由不同函数负责：

| 时机 | 函数 | 触发条件 |
|---|---|---|
| `agent_end` 后（`onAgentEnd`） | `maybeCompact()` | 安全网：接近上下文硬上限 |
| `sendMessage` 前（发送新消息时） | `maybeCompactPreSend()` | 主动压缩：cache 已过期 + context 较大；或跨天 |

这种拆分的原因：刚结束一轮对话时 Anthropic cache 仍然有效（5 分钟 TTL），此时压缩会破坏正在积累的缓存前缀，得不偿失。只有在 cache 已确定过期（空闲 > 5 min）时，压缩才是净节省。

---

### 触发器一：安全网（`shouldCompact`）

```ts
// compaction.ts
export function shouldCompact(contextTokens: number, model: Model<any>): boolean {
  return contextTokens > model.contextWindow - RESERVE_TOKENS  // 16,384
}
// 对 200k 模型 → 超过 183,616 token 触发
```

防止撑爆上下文窗口的最后防线。发生在 `agent_end` 后，始终检查。

---

### 触发器二：主动压缩（`shouldCompactProactive`）

```ts
// compaction.ts
export function shouldCompactProactive(contextTokens: number, idleMs: number): boolean {
  return contextTokens > PROACTIVE_COMPACT_TOKENS && idleMs > CACHE_TTL_MS
}
// PROACTIVE_COMPACT_TOKENS = 80,000 / CACHE_TTL_MS = 5 分钟
```

**运行时机：** 发送新消息前（`maybeCompactPreSend`）。

**背景：** Anthropic 5 分钟缓存过期后，每次请求都要付全价 input token。thinking 模型每轮消耗 5–15k token，20 轮后轻松达到 150k。当空闲超过 5 分钟时，cache 已过期，此时将 80k+ 压缩到 ~50k，新一轮请求直接以更小的 context 开始。

**为什么不在 `agent_end` 后触发：** 刚结束一轮时 cache 仍有效（TTL 内）。贸然压缩会：① 破坏正在积累的前缀缓存；② 为本次轮次额外付出 LLM 压缩调用的 token 费用。

---

### 触发器三：跨天压缩（`shouldCompactByTime`）

```ts
// compaction.ts
export function shouldCompactByTime(messages: AgentMessage[]): boolean {
  // 跳过已有的 CompactionSummary，只看未压缩的尾部
  const startIdx = (messages[0] as any)?.role === 'compactionSummary' ? 1 : 0
  const slice = messages.slice(startIdx)

  const firstTs = (slice[0] as any).timestamp
  const firstDay = new Date(firstTs).toDateString()
  const today = new Date().toDateString()

  if (firstDay === today) return false  // 全部来自今天，不触发

  // 只有超过 CROSS_DAY_MIN_EXCHANGES 轮才值得压缩
  const userTurns = slice.filter((m) => (m as any).role === 'user').length
  return userTurns > CROSS_DAY_MIN_EXCHANGES
}
```

**运行时机：** 同样在 `maybeCompactPreSend` 中（与主动压缩并列检查，任一满足即触发）。

**场景：** 用户打开昨天或更早的对话继续聊天。Cache 已必然失效，历史消息全部以全价计费。压缩把旧轮次变成 <2k token 的摘要，大幅降低开销。

**与主动压缩的关系：**
- 主动压缩解决"对话正在进行中变长 + 空闲够久"的问题
- 跨天压缩解决"回来接着聊旧对话"的问题（无论 token 多少）
- 两者互补，任意一个满足即触发

---

### 压缩参数

| 常量 | 值 | 含义 |
|---|---|---|
| `RESERVE_TOKENS` | 16,384 | 为模型输出预留的 token |
| `KEEP_RECENT_TOKENS` | 50,000 | 保留最近 ~50k token 的原始消息 |
| `PROACTIVE_COMPACT_TOKENS` | 80,000 | 主动压缩 token 阈值 |
| `CACHE_TTL_MS` | 300,000（5 分钟） | Anthropic ephemeral cache TTL，主动压缩的 idle 门槛 |
| `CROSS_DAY_MIN_EXCHANGES` | 5 | 跨天触发所需的最少用户轮次 |

---

## 五、整体策略矩阵

| 优化措施 | Anthropic | OpenAI | Google | 说明 |
|---|---|---|---|---|
| **Stable system prompt** | ✅ 命中 5min 缓存 | ✅ 命中 ~1h 自动缓存 | ✅ 有助隐式缓存 | memory 移至对话历史注入 |
| **Redacted thinking** | ✅ 合规省 token | ✅ 空 block 被忽略 | ✅ 空 block 被忽略 | 老轮次只传签名 |
| **主动压缩 80k** | ✅ | ✅ | ✅ | 所有 provider 通用 |
| **跨天压缩** | ✅ | ✅ | ✅ | 所有 provider 通用 |
| **1h TTL 缓存** | ❌ 代理不支持 | ✅ 自动 | ❌ 显式缓存未实现 | 无需额外操作 |

---

## 六、相关文件索引

| 文件 | 职责 |
|---|---|
| `src/lib/agent/prompts.ts` | `buildSystemPrompt()` — 不含 memory 的稳定 system prompt |
| `src/lib/stores/chat.ts` | `assembleSystemPrompt()` — 不传 memory；`convertToLlm()` — memory 注入 + redacted thinking 转换；`appendMemoryUpdateIfNeeded()` — turn 结束后追加 delta；`refreshConvMemSnapshot()` — 刷新 base 快照 |
| `src/lib/agent/compaction.ts` | `shouldCompact()` — 安全网；`shouldCompactProactive()` — cache 过期后主动压缩；`shouldCompactByTime()` — 跨天压缩；`MemoryUpdateMessage` 类型定义 |
