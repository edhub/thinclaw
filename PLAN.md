# ThinClaw — AI Agent 迁移计划

## 目标
将 Vercel AI SDK 替换为 `@mariozechner/pi-ai` + `@mariozechner/pi-agent-core`，
添加 Persona（性格）系统、浏览器安全工具（calculator / datetime），
并升级 ChatMessage 渲染以支持思考块、工具调用卡片。

## 步骤

- [x] 1. **依赖替换** — 移除 `ai` / `@ai-sdk/openai`，安装 `@mariozechner/pi-ai` / `@mariozechner/pi-agent-core`
- [x] 2. **`src/lib/models.ts`** — 定义 3 个 `Model<'openai-completions'>` 对象（bianxie.ai baseUrl + 显式 compat）
- [x] 3. **`src/lib/personas.ts`** — 参考 openclaw SOUL.md 定义 5 个 Persona（助手/程序员/思考者/老师/创作者）
- [x] 4. **`src/lib/tools.ts`** — 浏览器安全工具：`calculate`（Math eval）、`get_datetime`
- [x] 5. **`src/lib/db/index.ts`** — 升级到 v2；conversations 加 personaId；messages 改存 `AgentMessage` JSON blob
- [x] 6. **`src/lib/stores/settings.ts`** — 添加 `personaId`；保留 `systemPrompt` 作为追加内容
- [x] 7. **`src/lib/stores/chat.ts`** — 完全重写：用 `Agent` 类替代 `streamText`，Svelte writable 桥接 agent 事件
- [x] 8. **`src/lib/components/ChatMessage.svelte`** — 支持 `ThinkingContent`（可折叠）/ `ToolCall` / `ToolResult` 渲染
- [x] 9. **`src/lib/components/Settings.svelte`** — 添加 Persona 选择器
- [x] 10. **`src/routes/+page.svelte`** — 适配新 store API：`streamingMessage` 分离展示，去掉旧参数
- [x] 11. **验证** — `pnpm check` + `pnpm build` 全部通过

## 关键设计决策

### SDK 选择
- `@mariozechner/pi-agent-core` — 纯 TS，零 Node.js 依赖，完整 agent loop（multi-turn tool call / steering / abort）
- `@mariozechner/pi-ai` — openai-completions provider 已内置 `dangerouslyAllowBrowser: true`；Node.js 模块用动态 import 且判断了环境，浏览器中安全降级

### Persona 系统
- Persona = 预设 system prompt 模板（基于 SOUL.md 风格）
- Settings 中可叠加自定义 system prompt（追加到 persona 末尾）
- 存在 localStorage，conversationId 记录创建时使用的 personaId

### DB v2 消息格式
```
messages store: { id, conversationId, seq, data: AgentMessage }
```
- `data` 直接存 pi-ai 的 AgentMessage JSON（UserMessage / AssistantMessage / ToolResultMessage）
- 旧 v1 数据直接丢弃（用户同意）

### Agent 单例
- 全局单个 `Agent` 实例，切换对话时 `replaceMessages()` 重置上下文
- `getApiKey` 回调每次从 settings store 读取，支持运行时修改 key
- agent 事件 → 更新 Svelte writables → 触发 UI 重渲染
