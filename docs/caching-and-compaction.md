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

## 二、System Prompt 与 Memory 注入

### 当前方案：Memory 作为最后一段 System Prompt

`assembleSystemPrompt()`（`chat.ts`）在每次 `sendMessage()` 前重建完整 system prompt，结构固定为四段：

```
[Soul + How-You-Operate]   ← 极稳定，仅 soul_update 时变化
[Active Persona]           ← 可选，会话期间锁定不变
[Custom Instructions]      ← 可选，Settings 中修改时变化
[Your Memory]              ← 可选，memory_save / memory_delete 时变化
```

`buildSystemPrompt()`（`prompts.ts`）返回 `SystemPromptParts { stableParts, memoryPart }`，
`assembleSystemPrompt()` 将各段 join 后传给 `agent.setSystemPrompt()`。

### Memory 放在最后的意义

System prompt 对所有 provider 而言都是前缀缓存的基础：
- **Anthropic**：provider (`pi-ai`) 自动在 system prompt 末尾打 `cache_control`，缓存整个 system 前缀
- **OpenAI / Google**：服务端自动识别重复前缀

Memory 最后放置确保，当新记忆被保存时，只有 system prompt 的末尾字节变化——虽然这会使 Anthropic 的 system 断点缓存失效（因为内容变了），但 **tools 级缓存**（`onPayload` hook 打在最后一个 tool 定义上，~3,500 tokens）不受影响，仍然每轮命中。

### 记忆写入与 system prompt 刷新

`memory_save` 写入 IndexedDB 并更新内存 store。下一次 `sendMessage()` 时 `assembleSystemPrompt()` 会读取 `memories.all()` 重建，新记忆自然出现在 `[Your Memory]` 段中。当前轮次的 LLM 调用已完成，不受影响。

```ts
// assembleSystemPrompt() — 每次 sendMessage() 前调用
const memoriesText = formatMemoriesForPrompt(memories.all())
const { stableParts, memoryPart } = buildSystemPrompt(
  soulContent, persona?.content, s.systemPrompt, memoriesText,
)
return [...stableParts, ...(memoryPart ? [memoryPart] : [])].join('\n\n')
```

### 对比：旧方案（Memory 注入为消息对）

旧方案为了避免 system prompt 因 memory 变化而破坏 Anthropic 缓存，将 memory 从 system prompt 中移出，改为在 `convertToLlm()` 中动态注入一对合成消息：

```ts
// 旧逻辑（已移除）
const memPrefix: Message[] = [
  { role: 'user', content: '[Your memories...]\n\n${memText}', timestamp: 0 },
  { role: 'assistant', content: 'I have reviewed my memories...', timestamp: 0 },
]
return [...memPrefix, ...converted]
```

同时还维护了 `_convMemSnapshot`（会话基线快照）和 `MemoryUpdateMessage`（delta 追加）两套机制来保证消息历史前缀稳定。

**移除原因：**
- 复杂度高，两套 memory 机制（base snapshot + delta）难以维护
- `MemoryUpdateMessage` 会污染消息历史，在 compaction 时需要特殊处理
- 现在 Anthropic 的缓存收益主要来自 tools 级断点（~3,500 tokens），system prompt 断点因低于 1,024 token 最低阈值本身不生效，memory 放回 system prompt 并无实际缓存损失

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
策略是**只缓存稳定不变的 tools 前缀**，不在 system prompt 或消息历史上手动加断点：

| 断点 | 约 tokens | 来源 | 稳定性 |
|---|---|---|---|
| ① | ~600 | System prompt 末尾（pi-ai 内置） | 随 memory 变化而变，且低于 Anthropic 1,024 最低阈值，实际不生效 |
| ② | ~3,500 | 最后一个 tool 定义（`onPayload` hook） | **永远不变 ✓ — 真正的稳定缓存层** |
| ③ | 变化 | 最后一条 user 消息（pi-ai 内置） | 跨 turn 前沿，有助于连续对话复用 |

```
每次 LLM 调用：
  [sys ← cc①(no-op)] [tools ← cc②] [...history...] [last_user ← cc③]
                       ↑ ~3,500 tokens 永远命中
```

**效果：** 无论对话内容或记忆如何变化，`system + tools` 前缀（~3,500 tokens）始终从缓存读取。
消息历史部分由 pi-ai 的 last-user 断点 ③ 提供跨 turn 的增量缓存。

**实现位置：** `src/lib/agent/payload.ts` → `onPayload()`

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


### 各 Provider 的兼容性

| Provider | 行为 | 说明 |
|---|---|---|
| Anthropic | 发送 `redacted_thinking` 块 | ✅ 合规省 token |
| Google | `thinking: ''` → `google-shared.js` 直接跳过空 thinking block | ✅ 无害 |
| OpenAI | `thinking: ''` → `openai-completions.js` 过滤空 thinking block | ✅ 无害 |

---

## 四、整体策略矩阵

| 优化措施 | Anthropic | OpenAI | Google | 说明 |
|---|---|---|---|---|
| **Stable system prompt** | ✅ tools 断点命中 | ✅ 命中 ~1h 自动缓存 | ✅ 有助隐式缓存 | memory 在 system prompt 末尾，tools 断点始终稳定 |
| **Redacted thinking** | ✅ 合规省 token | ✅ 空 block 被忽略 | ✅ 空 block 被忽略 | 老轮次只传签名 |
| **1h TTL 缓存** | ❌ 代理不支持 | ✅ 自动 | ❌ 显式缓存未实现 | 无需额外操作 |

---

## 五、相关文件索引

| 文件 | 职责 |
|---|---|
| `src/lib/agent/prompts.ts` | `buildSystemPrompt()` — 返回 `SystemPromptParts`；memory 作为最后一段 |
| `src/lib/stores/chat.ts` | `assembleSystemPrompt()` — 每轮重建，含最新 memory |
| `src/lib/agent/payload.ts` | `onPayload()` — 多 provider payload 重写 + tools 末尾 cache_control |
