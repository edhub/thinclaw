# bianxie.ai 代理接入说明

bianxie.ai 是一个多协议 AI 代理，ThinClaw 通过它访问 Claude 和 Gemini 模型。
单个 API Key 即可调用多个提供商，且支持浏览器直连（无 CORS 限制）。

---

## 支持的 API 协议（实测）

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

## ThinClaw 当前配置

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

Gemini 3.x Flash 模型使用 `thinkingLevel` enum（`MINIMAL/LOW/MEDIUM/HIGH`），
而不是 `budgetTokens`；pi-ai 对命中 `/gemini-3(?:\.\d+)?-flash/` 的模型自动走此路径。

---

## 新增模型步骤

1. 在 bianxie 控制台确认模型 ID
2. 在 `src/lib/models.ts` 追加一条记录，根据提供商选择 `api` 字段：
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
- **prompt caching 已可用，但受多账号路由影响**（2026-03 实测）：bianxie.ai 代理在 `usage` 中返回
  非零的 `cacheRead`/`cacheWrite`，Anthropic prompt caching 正常工作。
  但代理会将不同请求**负载均衡到不同的 Anthropic 账号**，而 Anthropic 的 prompt cache
  是**按账号隔离**的——不同账号之间的缓存无法共用。这导致缓存命中率取决于路由的随机性：
  连续请求如果恰好路由到同一账号则命中，否则全量重写。
  ThinClaw 通过 `onPayload` hook 在 system、tools、倒数第二条 user 消息上放置 `cache_control` 断点，
  确保同账号内的请求能最大化缓存复用（详见 `docs/caching-and-compaction.md`）。
