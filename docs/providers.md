# 聚合 API 代理接入说明

ThinClaw 通过多个聚合 API 代理访问 Claude / Gemini / OpenAI 等模型，
浏览器可直连（无 CORS 限制），无需自建后端。

---

## bianxie.ai

bianxie 在同一个域名下暴露了多套协议端点，但**并非所有协议对所有模型都可用**。
以下结论基于 2026-03-12 的实测：

| 协议 | 端点 | Claude | Gemini | OpenAI |
|---|---|---|---|---|
| OpenAI Chat Completions | `POST /v1/chat/completions` | ✅ | ✅ | ✅ |
| OpenAI Responses API | `POST /v1/responses` | ❌ `not implemented` | ❌ `not implemented` | ✅ |
| Anthropic Messages API | `POST /v1/messages` | ✅ | — | — |
| Google Generative AI | `POST /v1beta/models/{model}:generateContent` | — | ✅ | — |

**结论：Claude 和 Gemini 各有原生协议可用，Responses API 仅限 OpenAI 原生模型。**

---

### ThinClaw 配置 (bianxie)

使用原生协议而非 OpenAI 兼容格式，以充分利用各提供商的特有功能。
thinking 模型统一使用 `medium` effort（由 `model.reasoning = true` 自动触发）。

### Claude 模型 → Anthropic Messages API

```ts
{
  api: 'anthropic-messages',
  provider: 'bianxie',
  baseUrl: 'https://api.bianxie.ai',   // @anthropic-ai/sdk 自动拼接 /v1/messages
}
```

可用特性：extended thinking、cache control、fine-grained tool streaming。

### Gemini 模型 → Google Generative AI API

```ts
{
  api: 'google-generative-ai',
  provider: 'bianxie',
  baseUrl: 'https://api.bianxie.ai/v1beta',  // pi-ai 设 apiVersion="" 不再追加版本段
}
```

可用特性：thinkingConfig、thoughtSignature（thinking budget 原生控制）。

---

## 灵芽 (lingyaai.cn)

灵芽同样支持 Google Generative AI 与 Anthropic Messages 原生协议，端点与官方格式完全相同。

### 鉴权

- **Anthropic**：`Authorization: Bearer <key>`（标准格式，SDK 自动处理）
- **Google GenAI**：URL 查询参数 `?key=$API_KEY`（Google GenAI SDK 默认行为，自动处理）

  **注意**：部分灵芽 Gemini 代理不识别 `x-goog-api-key` 请求头，ThinClaw 对 `provider === 'lingyaai'`
  的 Google 模型会额外注入 `Authorization: Bearer` 头（见 `chat.ts` `makeStreamFn`）。

### ThinClaw 配置 (lingyaai)

```ts
{
  // Anthropic 模型
  api: 'anthropic-messages',
  provider: 'lingyaai',
  baseUrl: 'https://api.lingyaai.cn', // SDK appends /v1/messages
}

{
  // Google 模型
  api: 'google-generative-ai',
  provider: 'lingyaai',
  baseUrl: 'https://api.lingyaai.cn/v1beta',
}
```

参考文档：https://api.lingyaai.cn/doc/#/coding/gemini

Gemini 3.x Flash 模型使用 `thinkingLevel` enum（`MINIMAL/LOW/MEDIUM/HIGH`），
而不是 `budgetTokens`；pi-ai 对命中 `/gemini-3(?:\.\d+)?-flash/` 的模型自动走此路径。

---

## 新增模型步骤

1. 在对应代理控制台确认模型 ID
2. 在 `src/lib/agent/models.ts` 追加一条记录，根据提供商选择 `api` 字段：
   - Anthropic 模型 → `api: 'anthropic-messages'`，`baseUrl: 'https://api.bianxie.ai'`
   - Google 模型 → `api: 'google-generative-ai'`，`baseUrl: 'https://api.bianxie.ai/v1beta'`
   - OpenAI 原生模型 → `api: 'openai-completions'` 或 `'openai-responses'`，`baseUrl: 'https://api.bianxie.ai/v1'`
3. 无需任何其他改动，API Key 由运行时 Settings 注入

---

## 鉴权

所有协议统一使用 `Authorization: Bearer <key>` 请求头，与 OpenAI 格式相同。
Anthropic 原生 API 通常要求 `x-api-key` 头，但 bianxie 接受 Bearer 格式。

---

## 已知限制

- Responses API（`/v1/responses`）不支持 Claude / Gemini，返回 `convert_request_failed`
- cache control 的 TTL 加成（`1h`）在 pi-ai 内部仅对 `api.anthropic.com` 生效，
  走 bianxie 时退化为无 TTL（仍可使用 cache，只是不保证保留时长）
- **Anthropic prompt caching 已可用**（2026-03 实测）：bianxie.ai 代理正确转发 `cache_control`，
  Anthropic prompt caching 正常工作。缓存断点由 pi-ai 的 `cacheRetention="short"` 策略自动注入，
  ThinClaw 不需要手动设置 `cache_control`。pi-ai 在每次请求中自动在 system prompt 末尾、
  最后一个 tool 定义（~3,500 tokens，永远稳定）和最后一条 user 消息三处打断点。
  ThinClaw 的 `onPayload` hook 仅做无侵入的 payload 快照（供 SessionViewer 调试），不修改请求内容。
  **注意：** thinking block 从完整形式转为 redacted 形式会改变前缀字节导致缓存失效，
  ThinClaw 使用 3-turn buffer 策略延缓 redact 时机以减少影响（详见 `docs/caching-and-compaction.md`）。
- **bianxie 多账号路由**（2026-03 实测）：尽管管理员声称使用同一账号，session 数据表明代理
  在至少 2 个 Anthropic 账号间做负载均衡。Anthropic 的 prompt cache 是**按账号隔离**的，
  不同账号之间的缓存无法共用。证据与详细分析见 `docs/caching-and-compaction.md`。
- **Google Gemini implicit caching**（2026-03 实测）：Google 的隐式缓存按模型有不同的最低 token
  触发阈值。`gemini-3-flash-preview-thinking` 阈值较低（约 1k–4k tokens），正常命中缓存；
  `gemini-3.1-pro-preview-thinking` 阈值较高（约 32k tokens），ThinClaw 典型请求 ~3.6k tokens
  远低于此阈值，因此 **Pro 模型从未触发缓存**。这是 Google 侧的模型策略，客户端无法控制。
