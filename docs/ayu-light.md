# ThinClaw — Ayu Light 样式规范

> 本文档是 ThinClaw 前端的视觉设计规范，以 **Ayu Light** 作为唯一主题（不提供深色/系统切换）。

---

## 1. 为什么选 Ayu Light

Ayu Light 是一套来自代码编辑器世界的配色方案，由 Ike Ku 创作，核心特点：

- **暖白纸感**：背景不是刺眼的纯白，而是微微偏米色的 `#FAFAFA`，阅读舒适
- **低对比度 UI，高对比度内容**：界面元素用低饱和度的暖灰，让用户注意力聚焦在对话内容上
- **标志性橙色 Accent**：`#FF9940` 是 Ayu 的品牌色，明亮活泼而不刺眼
- **与代码世界同源**：语法高亮色系直接来自 Ayu Light，代码块视觉统一

---

## 2. 调色板（原始值）

以下是从 [ayu-theme/ayu-colors](https://github.com/ayu-theme/ayu-colors) 提取的 Light 方案原色：

### 界面色

| 用途 | Token 名 | 颜色值 | 预览 |
|---|---|---|---|
| 页面背景 | `bg` | `#FAFAFA` | 近乎纯白的米白 |
| 面板背景（侧边栏、卡片头） | `ui.panel.bg` | `#F3F3F3` | 浅灰米色 |
| 输入框背景 | `ui.input.bg` | `#F0EFEA` | 比面板略暖 |
| 选中/激活背景 | `ui.selection.bg` | `#E9E7DA` | 暖灰米 |
| 悬停背景 | `ui.hover.bg` | `#EDEDEC` | 微灰 |
| 分割线/边框 | `ui.line` | `#D8D7CE` | 暖色边框 |
| 主文字 | `fg` | `#575F66` | 暖深灰，非纯黑 |
| 次要文字（标签、说明） | `ui.fg` | `#6E7A85` | 中灰蓝 |
| 占位/静音文字 | `comment` | `#959DA6` | 浅灰蓝 |

### 强调色

| 用途 | Token 名 | 颜色值 |
|---|---|---|
| 主 Accent（按钮、链接、选中） | `common.accent` | `#FF9940` |
| 焦点边框、激活边框 | 同 Accent | `#FF9940` |

### 语法色（同时用于 UI badge）

| 语义 | 颜色值 | 用途示例 |
|---|---|---|
| 字符串 / success | `#86B300` | user badge 背景 |
| 关键字 / orange | `#FA8D3E` | tool badge |
| 常量 / purple | `#A37ACC` | 内联代码 |
| 实体 / blue | `#399EE6` | session badge |
| 函数 / yellow | `#F2AE49` | assistant badge |
| 注释 / grey | `#ABB0B6` | compaction badge |
| 错误 | `#E45649` | 错误状态 |
| 警告 | `#FAAC00` | 警告状态 |

---

## 3. 设计 Token（CSS Custom Properties）

这些变量定义在 `:root` 中，是 ThinClaw 所有组件的颜色来源。

```css
:root {
  /* ── Accent ── */
  --accent: #FF9940;

  /* ── Surfaces（由浅到深，越往下越有"重量感"） ── */
  --surface-main:     #FAFAFA;   /* 页面/聊天区背景 */
  --surface-sidebar:  #F3F3F3;   /* 侧边栏、面板 */
  --surface-elevated: #ECEADF;   /* 卡片、弹出层 */
  --surface-hover:    #E8E6DC;   /* 悬停态 */
  --surface-active:   #E0DDD0;   /* 激活/选中态 */
  --surface-input:    #F0EFEA;   /* 输入框背景 */

  /* ── Text ── */
  --text-primary:   #575F66;     /* 正文 */
  --text-secondary: #6E7A85;     /* 次要文字（标签、说明） */
  --text-muted:     #959DA6;     /* 占位符、静音信息 */

  /* ── Border ── */
  --border: #D8D7CE;             /* 分割线、边框 */

  /* ── Code ── */
  --code-bg:          #F8F5EA;   /* 代码块背景（暖纸色） */
  --code-inline-bg:   #EEEAD8;   /* 内联代码背景 */
  --code-inline-color: #A37ACC;  /* 内联代码前景（紫色常量色） */

  /* ── State: Error ── */
  --error:    #E45649;
  --error-bg: #FAEDE9;

  /* ── State: Warning ── */
  --warn-color: #A8620E;         /* 加深橙，确保在浅色背景上可读 */
  --warn-bg:    #FFF4E0;

  /* ── Badges（语义角色色） ── */
  --badge-session-bg:     #D6EBF9;  --badge-session-fg:     #1F6FA8;
  --badge-user-bg:        #DDF0B8;  --badge-user-fg:        #4D7A00;
  --badge-assistant-bg:   #EEE5F8;  --badge-assistant-fg:   #6B3FA0;
  --badge-tool-bg:        #FDEBD0;  --badge-tool-fg:        #8A4D00;
  --badge-compaction-bg:  #EDECEA;  --badge-compaction-fg:  #5A6068;
}
```

---

## 4. Tailwind `@theme inline` 映射

在 `app.css` 中通过 `@theme inline` 将 Token 暴露为 Tailwind 工具类，避免在模板里写 `style=` 内联。

```css
@theme inline {
  --color-accent:          var(--accent);
  --color-surface:         var(--surface-main);
  --color-surface-sidebar: var(--surface-sidebar);
  --color-surface-elevated:var(--surface-elevated);
  --color-surface-hover:   var(--surface-hover);
  --color-surface-active:  var(--surface-active);
  --color-surface-input:   var(--surface-input);
  --color-fg:              var(--text-primary);
  --color-fg-sub:          var(--text-secondary);
  --color-fg-muted:        var(--text-muted);
  --color-line:            var(--border);
  --color-error:           var(--error);
  --color-error-bg:        var(--error-bg);
  --color-warn:            var(--warn-color);
  --color-warn-bg:         var(--warn-bg);
}
```

常用生成工具类：

| Tailwind 类 | 生成 CSS | 典型用途 |
|---|---|---|
| `bg-surface` | `background: #FAFAFA` | 页面背景 |
| `bg-surface-sidebar` | `background: #F3F3F3` | 侧边栏 |
| `bg-surface-elevated` | `background: #ECEADF` | 卡片、ToolCard |
| `bg-surface-hover` | `background: #E8E6DC` | 按钮悬停 |
| `bg-surface-active` | `background: #E0DDD0` | 选中项 |
| `bg-surface-input` | `background: #F0EFEA` | 输入框 |
| `bg-accent` | `background: #FF9940` | 主按钮、FAB |
| `text-fg` | `color: #575F66` | 主文字 |
| `text-fg-sub` | `color: #6E7A85` | 次要文字 |
| `text-fg-muted` | `color: #959DA6` | 占位符 |
| `text-accent` | `color: #FF9940` | 强调链接 |
| `text-error` | `color: #E45649` | 错误提示 |
| `border-line` | `border-color: #D8D7CE` | 分割线 |

---

## 5. 字体排版

### 字体栈

```css
/* UI 通用 */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', system-ui, sans-serif;

/* 代码、等宽 */
font-family: 'Fira Code', 'Cascadia Code', 'Menlo', 'Monaco', Consolas, monospace;
```

### 字号层级

| 用途 | 字号 | Tailwind |
|---|---|---|
| 大标题（欢迎页） | 1.75rem | `text-[1.75rem]` |
| 页面标题 | 1rem | `text-base` |
| 正文/消息 | 0.9375rem (15px) | `text-[0.9375rem]` |
| 普通 UI 文字 | 0.875rem (14px) | `text-sm` |
| 小型 UI（标签、说明） | 0.82rem | `text-[0.82rem]` |
| 最小（元信息、时间戳） | 0.72rem | `text-[0.72rem]` |

### 字重

- `font-bold` (700) — 品牌名、大标题
- `font-semibold` (600) — 区块标题、用户名
- `font-medium` (500) — 按钮文字
- `font-normal` (400) — 正文

---

## 6. 圆角与间距

### 圆角（从小到大）

| 用途 | 值 | Tailwind |
|---|---|---|
| 标签、小 badge | 4px | `rounded` |
| 小按钮、行内元素 | 5–6px | `rounded-md` |
| 标准按钮、输入框、卡片 | 8px | `rounded-lg` |
| 较大卡片、下拉菜单 | 10–12px | `rounded-xl` |
| 模态框、文件选择器 | 16px | `rounded-2xl` |
| 头像、FAB、圆形按钮 | 50% | `rounded-full` |

### 间距基准

采用 Tailwind 默认 4px 步进：`gap-1`=4px `gap-2`=8px `gap-3`=12px `gap-4`=16px `gap-6`=24px

常见组合：
- 列表项内边距：`px-2.5 py-1.5` (10px 6px)
- 卡片内边距：`px-3 py-2` (12px 8px)
- 面板/区块内边距：`px-4 py-3` (16px 12px)
- 页面级内边距：`px-6` (24px)

---

## 7. 组件规范

### 按钮

#### Primary Button（主操作）
```
背景: bg-accent (#FF9940)
文字: text-white
圆角: rounded-lg (8px)
内边距: px-5 py-1.5
字重: font-medium
悬停: opacity-85
禁用: opacity-40 cursor-not-allowed
```

#### Ghost Button（次要/工具栏）
```
背景: bg-transparent
边框: border border-line
文字: text-fg-sub
圆角: rounded-lg
悬停: bg-surface-hover text-fg
```

#### Icon Button（纯图标）
```
尺寸: w-8 h-8 (32px)
背景: bg-transparent / border-none
颜色: text-fg-muted
圆角: rounded-lg
悬停: bg-surface-hover text-fg
```

#### Danger variant
```
悬停: text-error bg-error-bg
```

### 输入框 / Textarea
```
背景: bg-surface-input
边框: border border-line, rounded-lg
文字: text-fg
内边距: px-3 py-2 (12px 8px)
聚焦: border-accent (outline: none)
占位: text-fg-muted
```

### 卡片（ToolCard、FileContextCard）
```
背景: bg-surface-elevated
边框: border border-line, rounded-lg (或 rounded-[7px])
卡片头: bg-transparent, hover:bg-surface-hover
展开体: border-t border-line
```

### 聊天消息气泡
- 无气泡，纯文字布局
- 用户/AI 用 avatar + role label 区分
- 底部 `border-b border-line/50` 分隔，最后一条无

### Sidebar 会话项
```
选中: bg-surface-active text-fg
悬停: bg-surface-hover text-fg
文字: text-sm text-fg-sub
圆角: rounded-lg
内边距: px-2.5 py-2
```

---

## 8. 代码块样式（highlight.js）

因整体为浅色主题，代码块保持「暖纸色」风格，不使用深色背景：

```css
--code-bg: #F8F5EA;          /* 代码块整体背景 */
--code-inline-bg: #EEEAD8;   /* 内联代码背景 */
--code-inline-color: #A37ACC; /* 内联代码前景 */
```

highlight.js 主题切换为 `github.css`（浅色），替换原来的 `github-dark.css`。

---

## 9. 滚动条

```css
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: #D8D7CE;   /* var(--border) */
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: #959DA6;   /* var(--text-muted) */
}
```

---

## 10. 移除的功能

以下功能在本次改版中**删除**，不再提供：

| 功能 | 原因 |
|---|---|
| `[data-theme='dark']` CSS 块 | 只用 Ayu Light，无需多主题 |
| `@media (prefers-color-scheme: dark)` 块 | 同上 |
| Settings 页「主题」选项 | 单一主题，不需要选择 |
| `Settings.theme` store 字段 | 不再需要主题状态 |
| `$effect` 中的 `data-theme` 属性写入 | 不再需要 |
| `highlight.js/styles/github-dark.css` | 改用浅色版 `github.css` |

---

## 11. 品牌色应用指南

`#FF9940` 用于以下场景，**不要滥用**：
- ✅ 主操作按钮（发送、保存、添加）
- ✅ FAB 浮动按钮
- ✅ 输入框 / 选中边框
- ✅ 激活的导航项（文字色）
- ✅ 链接、`<a>` 元素
- ✅ 进度指示、光标 blink
- ❌ 大面积背景填充（会显得过重）
- ❌ 普通文字正文（对比度不够）

---

## 12. 变更清单（实现检查表）

- [ ] `src/app.css` — 更新 Token，移除 dark 媒体查询，改 hljs 为 `github.css`
- [ ] `src/lib/stores/settings.ts` — 移除 `Theme` 类型和 `theme` 字段
- [ ] `src/routes/+page.svelte` — 移除 `data-theme` 写入 `$effect`
- [ ] `src/routes/settings/+page.svelte` — 移除「外观 & 主题」中的主题选择器
