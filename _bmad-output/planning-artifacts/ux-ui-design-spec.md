---
title: SayIt UI 设计规范
description: 给 AI Agent 的前端 UI/UX 设计规则集
author: Jackle
date: 2026-03-02
---

# SayIt UI 设计规范

本文件定义 SayIt 桌面应用的 UI/UX 设计规则。所有 AI Agent 在生成或修改前端程式码时**必须**遵守这些规则。

## 迁移状态

本规范描述的是**目标状态**。以下列出当前与目标之间的差距：

**尚未完成的基础设定：**

- Teal 品牌主题未套用 — 需执行 `pnpm dlx shadcn-vue@latest init --theme teal` 覆写 CSS 变数
- Dark mode 未启用 — `main-window.html` 和 `index.html` 的 `<html>` 标签需加上 `class="dark"`
- `src/components/ui/` 目录不存在 — 尚未安装任何 shadcn-vue 元件
- `--destructive-foreground` 和状态色（success/warning/info）CSS 变数未定义

**现有程式码的违规项目：**

- `MainApp.vue`：使用 Emoji 图标、硬编码 `bg-zinc-950`/`text-white`/`border-zinc-800`
- `SettingsView.vue`：使用 `window.confirm()`、硬编码色彩、`lg:` 响应式断点、裸 HTML input/button
- 其他 View 页面：使用 `text-white`/`text-zinc-400` 等原生色彩

**规则适用范围：**

- **所有新开发的元件和页面**：必须完全遵守本规范
- **修改现有元件时**：顺手将接触到的区域迁移至本规范
- **不主动大规模重构**：除非 Story 明确要求

## 设计稿审核流程（强制）

任何 UI 实作前，**必须**先在设计稿中完成视觉设计并取得使用者确认。

**设计稿档案：** `/Users/jackle/workspace/say-it/design.pen`

**流程：**

1. **设计先行**：收到 UI 相关 Story 或任务时，先在 `design.pen` 中建立对应页面/元件的设计稿
2. **遵循本规范**：设计稿必须使用本文件定义的色彩系统、元件、间距、排版规则
3. **截图呈现**：完成设计稿后，截取画面呈现给使用者审查
4. **等待确认**：使用者确认设计稿后，才可进入程式码实作阶段
5. **设计变更同步**：若实作过程中需调整设计，先更新 `design.pen` 并再次确认

**禁止行为：**

- 未经设计稿确认就直接写 UI 程式码
- 实作与已确认的设计稿不一致
- 跳过设计稿流程（即使是「小调整」）

## 设计系统基础

### 元件框架：shadcn-vue（强制）

- **所有 UI 元件必须使用 shadcn-vue**，禁止手写替代品
- 安装指令：`npx shadcn-vue@latest add <component>`
- 元件使用前必须先用 CLI 安装，安装后才会出现在 `src/components/ui/`
- 设定风格：`new-york`
- 基底色：`neutral`
- 图标库：`lucide`（`components.json` 中的值，实际 npm 套件为 `lucide-vue-next`）
- 元件安装目录：`src/components/ui/`
- 工具函式：`cn()` 来自 `@/lib/utils`（clsx + tailwind-merge）
- 动画库：`tw-animate-css`（已安装，shadcn-vue 元件的展开/收合动画依赖此库）

### cn() 使用方式

在使用端合并或覆盖 shadcn-vue 元件的样式：

```vue
<script setup lang="ts">
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const props = defineProps<{ fullWidth?: boolean }>()
</script>

<template>
  <Button :class="cn('gap-2', fullWidth && 'w-full')">
    <slot />
  </Button>
</template>
```

### 例外区域（允许手写 CSS）

以下元件不适用 shadcn-vue 改造，允许保留手写样式：

- `NotchHud.vue` — Notch clip-path 动画引擎
- `App.vue` — Notch 启动序列动画

## 色彩系统

### 品牌色：Teal

品牌主题透过 `pnpm dlx shadcn-vue@latest init --theme teal` 设定（**待执行**，当前 `style.css` 仍为 neutral 预设值）。执行后 Teal 主题会覆盖 `--primary` 系列变数为以下值：

**Light mode：**

| 变数 | Tailwind 色阶 | oklch 值 |
|------|-------------|---------|
| `--primary` | teal-600 | `oklch(0.6 0.118 184.704)` |
| `--primary-foreground` | teal-50 | `oklch(0.984 0.014 180.72)` |
| `--sidebar-primary` | teal-600 | `oklch(0.6 0.118 184.704)` |
| `--sidebar-ring` | teal-400 | `oklch(0.777 0.152 181.912)` |

**Dark mode：**

| 变数 | Tailwind 色阶 | oklch 值 |
|------|-------------|---------|
| `--primary` | teal-500 | `oklch(0.704 0.14 182.503)` |
| `--primary-foreground` | teal-50 | `oklch(0.984 0.014 180.72)` |
| `--sidebar-primary` | teal-500 | `oklch(0.704 0.14 182.503)` |
| `--sidebar-ring` | teal-900 | `oklch(0.386 0.063 188.416)` |

### 规则：只用语意色彩变数

**禁止**直接使用 Tailwind 原生色彩（如 `zinc-800`、`teal-600`、`red-500`）。
**必须**使用 shadcn-vue 定义的语意色彩变数。

| 用途 | 正确 | 禁止 |
|------|------|------|
| 页面背景 | `bg-background` | `bg-zinc-950` |
| 主要文字 | `text-foreground` | `text-white` |
| 次要文字 | `text-muted-foreground` | `text-zinc-400` |
| 卡片背景 | `bg-card` | `bg-zinc-900` |
| 卡片文字 | `text-card-foreground` | `text-zinc-100` |
| 边框 | `border-border` | `border-zinc-700` |
| 主要操作（teal） | `bg-primary` | `bg-teal-600` |
| 主要操作文字 | `text-primary-foreground` | `text-white` |
| 次要操作 | `bg-secondary` | `bg-zinc-700` |
| 次要操作文字 | `text-secondary-foreground` | `text-zinc-200` |
| 危险操作 | `bg-destructive` | `bg-red-500` |
| 表单输入边框 | `border-input` | `border-zinc-600` |
| 悬浮/选取 | `bg-accent` | `bg-zinc-800` |
| 聚焦外框 | `ring-ring` | `ring-teal-500` |
| 下拉选单背景 | `bg-popover` | `bg-zinc-900` |
| 下拉选单文字 | `text-popover-foreground` | `text-white` |

### 状态色

在 `src/style.css` 中新增以下自订语意色彩变数，用于业务状态指示：

```css
/* 在 :root 中加入 */
--success: oklch(0.59 0.145 163.225);
--success-foreground: oklch(0.985 0 0);
--warning: oklch(0.75 0.183 55.934);
--warning-foreground: oklch(0.205 0 0);
--info: oklch(0.623 0.214 259.815);
--info-foreground: oklch(0.985 0 0);

/* 在 .dark 中加入 */
--success: oklch(0.696 0.17 162.48);
--success-foreground: oklch(0.145 0 0);
--warning: oklch(0.828 0.189 84.429);
--warning-foreground: oklch(0.145 0 0);
--info: oklch(0.623 0.214 259.815);
--info-foreground: oklch(0.985 0 0);
```

在 `@theme inline` 中加入对应映射：

```css
--color-success: var(--success);
--color-success-foreground: var(--success-foreground);
--color-warning: var(--warning);
--color-warning-foreground: var(--warning-foreground);
--color-info: var(--info);
--color-info-foreground: var(--info-foreground);
```

**状态色使用场景：**

| 状态 | class 范例 | 使用场景 |
|------|-----------|---------|
| Success | `bg-success text-success-foreground` | API Key 验证成功、转录完成 Badge |
| Warning | `bg-warning text-warning-foreground` | API 逾时降级通知 |
| Info | `bg-info text-info-foreground` | 提示讯息、使用指引 |
| Destructive | `bg-destructive` | 删除确认、错误状态（已内建） |

### 注意：缺失的 CSS 变数

`src/style.css` 目前**未定义** `--destructive-foreground`。安装 shadcn-vue 的 `button` 元件（destructive variant）前，先补上此变数：

```css
/* 在 :root 中加入 */
--destructive-foreground: oklch(0.985 0 0);

/* 在 .dark 中加入 */
--destructive-foreground: oklch(0.985 0 0);
```

并在 `@theme inline` 中加入：

```css
--color-destructive-foreground: var(--destructive-foreground);
```

### 主题模式

- 本应用预设 **dark mode**（桌面常驻 App）
- Dark mode 透过在根元素加上 `class="dark"` 启用，目前在 `main-window.html` 和 `index.html` 的 `<html>` 标签设定
- 所有色彩变数在 `src/style.css` 的 `:root`（light）和 `.dark`（dark）中定义
- 色彩空间：oklch（已设定，AI Agent 不变更此设定）

### 图表配色

Dashboard 图表使用 teal 品牌色阶（由 `--theme teal` 自动设定，**待执行**后生效）：

| 变数 | Tailwind 色阶 | 用途 |
|------|-------------|------|
| `chart-1` | teal-300 | 主要资料线/面积 |
| `chart-2` | teal-500 | 次要资料线 |
| `chart-3` | teal-600 | 第三资料系列 |
| `chart-4` | teal-700 | 第四资料系列 |
| `chart-5` | teal-800 | 第五资料系列 |

## 元件使用规则

### 安装即用原则

需要新元件时，先用 CLI 安装。常用元件参考清单：

```bash
npx shadcn-vue@latest add button
npx shadcn-vue@latest add input
npx shadcn-vue@latest add card
npx shadcn-vue@latest add dialog
npx shadcn-vue@latest add select
npx shadcn-vue@latest add switch
npx shadcn-vue@latest add badge
npx shadcn-vue@latest add table
npx shadcn-vue@latest add tooltip
npx shadcn-vue@latest add separator
npx shadcn-vue@latest add scroll-area
npx shadcn-vue@latest add dropdown-menu
```

### 元件导入格式

```vue
<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
</script>
```

### Button 变体使用场景

| 场景 | variant | 范例 |
|------|---------|------|
| 主要操作 | `default` | 储存设定、确认 |
| 危险操作 | `destructive` | 删除词汇、清除历史 |
| 次要操作 | `outline` | 取消、返回 |
| 不显眼操作 | `ghost` | 工具列按钮、导航项 |
| 连结式 | `link` | 外部连结 |
| 纯图标 | size `icon` | Sidebar 收合、复制 |

### 表单模式

使用 shadcn-vue 的 label + input 组合搭配手动结构化布局：

```vue
<script setup lang="ts">
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
</script>

<template>
  <div class="space-y-2">
    <Label for="api-key">Groq API Key</Label>
    <Input id="api-key" type="password" placeholder="gsk_..." />
    <p class="text-xs text-muted-foreground">从 Groq Console 取得你的 API Key</p>
  </div>
</template>
```

安装所需元件：

```bash
npx shadcn-vue@latest add label
npx shadcn-vue@latest add input
```

### 卡片模式（Dashboard 统计卡片）

```vue
<Card>
  <CardHeader class="pb-2">
    <CardTitle class="text-sm font-medium text-muted-foreground">
      总口述时间
    </CardTitle>
  </CardHeader>
  <CardContent>
    <div class="text-2xl font-bold">42 分钟</div>
  </CardContent>
</Card>
```

### 操作回馈：Toast

所有使用者操作的成功/失败回馈统一使用 `Sonner`（shadcn-vue 推荐的 Toast 方案）：

```bash
npx shadcn-vue@latest add sonner
```

```vue
<script setup lang="ts">
import { toast } from 'vue-sonner'

function handleSave() {
  // ...
  toast.success('API Key 已储存')
}
</script>
```

使用场景：储存设定、复制文字、删除词汇、API Key 操作。不再使用内嵌 `feedbackMessage` 模式。

### 载入状态：Skeleton

资料载入中使用 `Skeleton` 元件占位：

```bash
npx shadcn-vue@latest add skeleton
```

适用位置：Dashboard 统计卡片、History 记录列表、Dictionary 词汇表格。

## 图标系统

### 规则：只用 lucide-vue-next

```vue
<script setup lang="ts">
import { Mic, Settings, History, BookOpen, LayoutDashboard } from 'lucide-vue-next'
</script>

<template>
  <Mic class="size-4" />           <!-- 标准大小 -->
  <Settings class="size-5" />      <!-- Sidebar 大小 -->
</template>
```

**图标大小标准：**

| 位置 | class | 像素 |
|------|-------|------|
| 内文/按钮 | `size-4` | 16px |
| Sidebar 导航 | `size-5` | 20px |
| 空状态插图 | `size-12` | 48px |
| 页面标题 | `size-6` | 24px |

**禁止**使用 Emoji 作为 UI 图标（Notch HUD 启动动画中的 `🎙` 是唯一例外）。

**Sidebar 导航图标对应：**

| 路由 | 图标元件 |
|------|---------|
| `/dashboard` | `LayoutDashboard` |
| `/history` | `History` |
| `/dictionary` | `BookOpen` |
| `/settings` | `Settings` |

## 排版

### 字型

系统预设字型堆叠，不自订 font-family（Tauri WebView 跟随 OS）。

### 字级标准

| 用途 | class |
|------|-------|
| 页面标题 | `text-2xl font-bold` |
| 区块标题 | `text-lg font-semibold` |
| 卡片标题 | `text-sm font-medium text-muted-foreground` |
| 卡片数值 | `text-2xl font-bold` |
| 正文 | `text-sm` |
| 辅助说明 | `text-xs text-muted-foreground` |
| 标签 | `text-sm font-medium` |

## 间距与布局

### 间距标准

| 场景 | class |
|------|-------|
| 页面内距 | `p-6` |
| 区块间距 | `space-y-6` |
| 卡片内距 | 由 shadcn Card 预设处理 |
| 表单栏位间距 | `space-y-4` |
| 按钮组间距 | `gap-2` |
| Sidebar 项目间距 | `gap-1` |

### 页面布局结构

所有 View 页面遵循统一结构：

```vue
<template>
  <div class="flex-1 space-y-6 p-6">
    <!-- 页面标题 -->
    <div>
      <h1 class="text-2xl font-bold">页面标题</h1>
      <p class="text-sm text-muted-foreground">页面描述</p>
    </div>

    <!-- 内容区块 -->
    <section class="space-y-4">
      ...
    </section>
  </div>
</template>
```

### Sidebar 布局

MainApp.vue 使用固定 Sidebar + 动态内容区：

```
+----------+---------------------------+
|          |                           |
| Sidebar  |    <RouterView />         |
| w-56     |    flex-1                 |
|          |                           |
+----------+---------------------------+
```

- Sidebar 宽度：`w-56`（224px）
- 背景：`bg-sidebar`
- 边框：`border-r border-sidebar-border`
- 导航项文字：`text-sidebar-foreground`
- 活动项：`bg-sidebar-accent text-sidebar-accent-foreground`

## 动画与过渡

### 标准过渡

```css
/* 互动元素（按钮、连结、输入框） */
transition-colors          /* 色彩变化 */

/* 内容出现/消失 */
transition: opacity 180ms ease;

/* 布局变化 */
transition: all 200ms ease-out;
```

shadcn-vue 元件（Accordion、Collapsible 等）的展开/收合动画由 `tw-animate-css` 库提供，已在 `src/style.css` 中引入，不需额外设定。

### Notch 动画（仅限 HUD）

Notch 系统使用自订 cubic-bezier 曲线，这些数值已调校完成，AI Agent 不修改：

```
cubic-bezier(0.32, 0.72, 0, 1)     /* Notch 形状过渡 */
cubic-bezier(0.34, 1.56, 0.64, 1)  /* Notch 进入弹跳 */
```

**HUD 视觉状态摘要（Visual Redesign 后）：**

| 状态 | 视觉 | 说明 |
|------|------|------|
| recording | 6 根 bar 山丘形排列 + 计时器 | bin `[9,4,1,2,6,12]`，中间高两侧低 |
| transcribing | 5 个空心圆点依序亮起变实心 | dotSlide 周期 1.5s，扫描波浪效果 |
| success | 圆点汇聚 + SVG ✓ + 边缘绿光 | 无底色 flash，背景保持纯黑 |
| error | 圆点散开 + 抖动 + ↻ retry | 无底色 flash，背景保持纯黑 |
| collapsing | 尺寸缩小 200×32 + 内容淡出 | 过渡回 hidden |

### Vue Transition 命名

```vue
<!-- 淡入淡出 -->
<Transition name="fade">...</Transition>
```

```css
.fade-enter-active,
.fade-leave-active { transition: opacity 180ms ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
```

## 无障碍（Accessibility）

### 强制规则

- shadcn-vue 元件已内建 ARIA 属性，不要移除或覆盖
- 所有互动元素必须可用键盘操作
- Dialog 必须有焦点陷阱（shadcn Dialog 已内建）
- 表单栏位必须关联 `<label>`（使用 shadcn Label 元件）
- 图标按钮必须加 `aria-label` 或搭配 `sr-only` 文字

```vue
<!-- 正确：图标按钮带无障碍标签 -->
<Button variant="ghost" size="icon" aria-label="复制文字">
  <Copy class="size-4" />
</Button>
```

## 响应式设计

本应用为**固定尺寸桌面视窗**，不需要行动端响应式设计。

- Main Window：最小宽度 `800px`、最小高度 `600px`
- HUD Window：固定尺寸，由 Notch 引擎控制
- 不使用 `sm:`、`md:`、`lg:` 等响应式断点

## 元件档案组织

```
src/components/
├── ui/                     # shadcn-vue 元件（CLI 安装生成，不手动修改）
│   ├── button/
│   ├── card/
│   ├── input/
│   └── ...
├── NotchHud.vue            # Notch HUD 状态显示（手写例外）
├── AccessibilityGuide.vue  # macOS 权限引导（迁移时改用 shadcn Dialog）
└── [功能元件].vue           # 业务元件，使用 shadcn-vue 原子元件组合
```

### 规则

- `src/components/ui/` 内的档案由 shadcn CLI 生成，**不手动修改**
- 业务元件放在 `src/components/` 根目录或按功能建子目录
- 每个 `.vue` 档案使用 `<script setup lang="ts">` + Composition API
- Props 使用 TypeScript interface 定义

## 禁止事项清单

| 禁止 | 替代方案 |
|------|---------|
| 直接用 `zinc-*`、`blue-*` 等原生色彩 | 使用语意变数 `bg-primary`、`text-foreground` |
| 手写 Button/Input/Card/Dialog | 安装 shadcn-vue 元件 |
| 使用 Emoji 作为 UI 图标 | 使用 lucide-vue-next |
| 在 `ui/` 目录手动修改元件 | 透过 `cn()` 在使用端覆盖样式 |
| 使用 `px` 硬编码尺寸 | 使用 Tailwind spacing（`p-4`、`gap-2`） |
| 使用响应式断点 `sm:`/`md:`/`lg:` | 固定桌面布局 |
| Options API | Composition API + `<script setup>` |
| 裸 `<input>`/`<button>` HTML 元素 | shadcn `<Input />`、`<Button />` |
| `<style scoped>` 定义色彩或背景 | Tailwind utility class + 语意变数 |
| 直接在元件中 hardcode Tailwind 色彩变数值 | 引用 CSS 变数名称 |

## 页面布局规范

本节定义各页面的具体布局结构。所有页面共用 `MainApp.vue` 的 Sidebar + 内容区框架。

### 全域框架：MainApp.vue

使用 shadcn-vue 的 `SidebarProvider` + `SidebarInset` 模式取代目前的手写 Sidebar：

```
+--[SidebarProvider]-----------------------------------+
|                                                       |
| +--[Sidebar]--+ +--[SidebarInset]------------------+ |
| |  SayIt Logo | | +--[header]--------------------+ | |
| |  "SayIt"    | | | SidebarTrigger  Breadcrumb    | | |
| |             | | +-------------------------------+ | |
| |  Dashboard  | | |                               | | |
| |  历史记录   | | |    <RouterView />             | | |
| |  自订字典   | | |    (flex-1 space-y-6 p-6)     | | |
| |  设定       | | |                               | | |
| |             | | |                               | | |
| |  v0.1.0    | | |                               | | |
| +-------------+ +----------------------------------+ |
+-------------------------------------------------------+
```

**安装指令：**

```bash
npx shadcn-vue@latest add sidebar
```

**关键元件：**

| 元件 | 用途 |
|------|------|
| `SidebarProvider` | 包裹整个应用，管理收合状态 |
| `Sidebar` | 侧边栏容器，含 `SidebarHeader` / `SidebarContent` / `SidebarFooter` |
| `SidebarFooter` | 侧边栏底部，显示版本号（透过 Vite `__APP_VERSION__` 从 `package.json` 动态注入） |
| `SidebarMenu` + `SidebarMenuItem` + `SidebarMenuButton` | 导航项目 |
| `SidebarInset` | 主要内容区域 |
| `SidebarTrigger` | 收合/展开按钮 |

**收合状态：** Sidebar 收合后显示 icon-only 模式（宽度约 48px），仅显示导航图标。SidebarProvider 的 `collapsible="icon"` 属性控制。

**Sidebar 导航项定义：**

```ts
const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/history', label: '历史记录', icon: History },
  { path: '/dictionary', label: '自订字典', icon: BookOpen },
  { path: '/settings', label: '设定', icon: Settings },
]
```

### Dashboard 页面（`/dashboard`）

参考 shadcn-vue `dashboard-01` block 布局。

**安装 block（可取得完整范例程式码）：**

```bash
npx shadcn-vue@latest add dashboard-01
```

**布局结构：**

```
+--[页面容器 flex-1 space-y-6 p-6]---------------------+
|                                                        |
| +--[标题区]----------------------------------------+  |
| | "Dashboard"                text-2xl font-bold     |  |
| | "语音转文字统计总览"       text-muted-foreground  |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[统计卡片 grid grid-cols-2 gap-4]-----------------+  |
| | +--Card------+ +--Card------+                      |  |
| | |总口述时间  | |口述字数    |                      |  |
| | |42 分钟     | |12,350字    |                      |  |
| | +------------+ +------------+                      |  |
| | +--Card------+ +--Card------+                      |  |
| | |平均口述速度| |节省时间    |                      |  |
| | |185字/分    | |28 分钟     |                      |  |
| | +------------+ +------------+                      |  |
| | +--Card------+ +--Card------+                      |  |
| | |使用次数    | |AI整理使用率|                      |  |
| | |156 次      | |87%         |                      |  |
| | +------------+ +------------+                      |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[趋势图表 Card]----------------------------------+  |
| | CardHeader: "使用趋势"  [时间筛选 Select]         |  |
| | CardContent:                                       |  |
| |   Area Chart（每日口述次数 / 字数趋势）            |  |
| |   X 轴：日期   Y 轴：次数或字数                    |  |
| |   使用 chart-1 (teal-300) 作为主要面积色           |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[最近转录 Card]----------------------------------+  |
| | CardHeader: "最近转录"                             |  |
| | CardContent:                                       |  |
| |   Table:                                           |  |
| |   | 时间 | 原始文字(截断) | 字数 | AI整理 | 耗时 ||  |
| |   |------|----------------|------|--------|------||  |
| |   | ...  | ...            | ...  | Badge  | ...  ||  |
| |   分页元件（若记录 > 10 笔）                       |  |
| +---------------------------------------------------+  |
+--------------------------------------------------------+
```

**统计卡片元件模式：**

每张 Card 遵循统一结构：

```vue
<Card>
  <CardHeader class="flex flex-row items-center justify-between pb-2">
    <CardTitle class="text-sm font-medium text-muted-foreground">
      总口述时间
    </CardTitle>
    <Badge variant="outline" class="text-xs">
      <TrendingUp class="mr-1 size-3" />
      +12%
    </Badge>
  </CardHeader>
  <CardContent>
    <div class="text-2xl font-bold">42 分钟</div>
    <p class="text-xs text-muted-foreground">较上周增加 5 分钟</p>
  </CardContent>
</Card>
```

**六项统计指标（对应 PRD FR24）：**

| 指标 | 卡片标题 | 数值格式 | 图标 |
|------|---------|---------|------|
| 总口述时间 | 总口述时间 | `X 分钟` 或 `X 小时 Y 分` | `Timer` |
| 口述字数 | 口述字数 | `12,350 字`（千位分隔） | `Type` |
| 平均口述速度 | 平均口述速度 | `185 字/分` | `Gauge` |
| 节省时间 | 节省时间 | `X 分钟`（预估打字所需时间 - 口述时间） | `Clock` |
| 使用次数 | 使用次数 | `156 次` | `Mic` |
| AI 整理使用率 | AI 整理使用率 | `87%` | `Sparkles` |

**趋势图表技术选型：**

使用 shadcn-vue 的 Chart 元件（底层为 [Unovis](https://unovis.dev/)）。安装：

```bash
npx shadcn-vue@latest add chart-area
```

**Dashboard 空状态：** 当历史记录为零时，统计卡片显示 `0`/`0%`/`0 分钟`，趋势图表区域显示空状态插图（`BarChart3` icon `size-12` + 「开始使用语音输入以累积统计资料」）。

### History 页面（`/history`）

```
+--[页面容器 flex-1 space-y-6 p-6]---------------------+
|                                                        |
| +--[标题区 + 搜寻]----------------------------------+  |
| | "历史记录"             text-2xl font-bold          |  |
| | "浏览与搜寻转录历史"   text-muted-foreground       |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[工具列 flex items-center gap-2]-----------------+  |
| | [Search Input w/ icon]              [排序 Select]  |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[记录列表 space-y-3]---------scroll-area----------+  |
| | +--Card (hover:bg-accent)---------------------+    |  |
| | | 2026-03-02 14:32     Badge:"AI整理"          |    |  |
| | | "会议记录：今天下午讨论了新功能的..."         |    |  |
| | | text-xs: 原始 52字 → 整理后 48字  耗时 1.2s  |    |  |
| | | [复制原始] [复制整理后] 按钮靠右 ghost        |    |  |
| | +----------------------------------------------+    |  |
| |                                                     |  |
| | +--Card------------------------------------------+  |  |
| | | ...下一笔记录...                                |  |  |
| | +------------------------------------------------+  |  |
| |                                                     |  |
| +-----------------------------------------------------+  |
|                                                        |
| +--[分页 flex justify-center]------------------------+  |
| | Pagination 元件                                    |  |
| +---------------------------------------------------+  |
+--------------------------------------------------------+
```

**关键元件：**

- 搜寻：`Input` + `Search` icon（lucide）
- 排序：`Select`（时间正序/倒序）
- 记录卡片：`Card` 包含转录内容截断显示（`line-clamp-2`）
- 复制按钮：`Button variant="ghost" size="icon"`，使用 `Copy` icon
- AI 整理标记：`Badge`（经 AI 整理的记录显示）
- 滚动区域：`ScrollArea`（固定高度，内部卷动）
- 分页：安装 `npx shadcn-vue@latest add pagination`

**记录卡片展开互动：** 点击卡片展开显示完整原始文字与整理后文字的对照。使用 `Collapsible` 元件。

**History 空状态：** 无记录时显示 `History` icon（`size-12 text-muted-foreground`）+ 「尚无转录记录」+ 「按住快捷键开始语音输入」。

### Dictionary 页面（`/dictionary`）

```
+--[页面容器 flex-1 space-y-6 p-6]---------------------+
|                                                        |
| +--[标题区]----------------------------------------+  |
| | "自订字典"             text-2xl font-bold          |  |
| | "管理自订词汇以提升转录精准度" text-muted-fg       |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[新增区 Card]-------------------------------------+  |
| | CardHeader: "新增词汇"                             |  |
| | CardContent:                                       |  |
| |   +--[flex gap-2]-------------------------------+  |  |
| |   | [Input placeholder="输入词汇..."]  [Button] |  |  |
| |   |                                    "新增"   |  |  |
| |   +---------------------------------------------+  |  |
| |   text-xs text-muted-foreground:                   |  |
| |   "词汇会同时注入 Whisper 辨识与 AI 整理上下文"    |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[词汇列表 Card]-----------------------------------+  |
| | CardHeader: "已建立词汇" Badge:"12 个"             |  |
| | CardContent:                                       |  |
| |   +--[Table]------------------------------------+  |  |
| |   | 词汇         | 建立时间        | 操作       |  |  |
| |   |--------------|-----------------|------------|  |  |
| |   | Fortuna      | 2026-03-01      | [删除]     |  |  |
| |   | NoWayLM      | 2026-03-01      | [删除]     |  |  |
| |   | OAuth        | 2026-02-28      | [删除]     |  |  |
| |   +----------------------------------------------+  |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[空状态（无词汇时显示）]---------------------------+  |
| |   BookOpen icon (size-12 text-muted-foreground)    |  |
| |   "尚未建立任何词汇"                                |  |
| |   "新增常用专有名词，提升辨识准确率"                |  |
| +---------------------------------------------------+  |
+--------------------------------------------------------+
```

**关键元件：**

- 新增表单：`Input` + `Button`（inline flex 布局）
- 词汇表格：`Table` + `TableHeader` + `TableBody` + `TableRow` + `TableCell`
- 删除按钮：`Button variant="ghost" size="icon"` + `Trash2` icon
- 删除确认：`AlertDialog`（取代 `window.confirm()`）
- 词汇计数：`Badge variant="secondary"`
- 空状态：居中图标 + 说明文字（参照 图标系统 > 空状态插图 `size-12`）

**安装所需元件：**

```bash
npx shadcn-vue@latest add table
npx shadcn-vue@latest add alert-dialog
```

### Settings 页面（`/settings`）

```
+--[页面容器 flex-1 space-y-6 p-6]---------------------+
|                                                        |
| +--[标题区]----------------------------------------+  |
| | "设定"                 text-2xl font-bold          |  |
| | "快捷键、API Key 与应用程式偏好" text-muted-fg     |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[快捷键设定 Card]--------------------------------+  |
| | CardHeader: "快捷键"  Keyboard icon               |  |
| | CardContent (space-y-4):                           |  |
| |   Label: "触发键"                                  |  |
| |   Select: macOS=[Fn/Option/Ctrl/Cmd/Shift]         |  |
| |           Windows=[右Alt/左Alt/Ctrl/Shift]         |  |
| |   Separator                                        |  |
| |   Label: "触发模式"                                |  |
| |   RadioGroup:                                      |  |
| |     ○ Hold（按住录音，放开停止）                   |  |
| |     ○ Toggle（按一下开始，再按一下停止）           |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[API Key 设定 Card]-------------------------------+  |
| | CardHeader:                                        |  |
| |   "Groq API Key"  Badge:"已设定"(success) or      |  |
| |                    Badge:"未设定"(destructive)      |  |
| | CardContent (space-y-4):                           |  |
| |   text-sm text-muted-foreground: Groq Console 连结 |  |
| |   Label + Input (type=password) + 显示/隐藏 Button |  |
| |   flex justify-between:                            |  |
| |     [储存 Button default] [删除 Button destructive]|  |
| +---------------------------------------------------+  |
|                                                        |
| +--[AI Prompt 设定 Card]-----------------------------+  |
| | CardHeader: "AI 整理 Prompt"  Sparkles icon        |  |
| | CardContent (space-y-4):                           |  |
| |   text-sm text-muted-foreground: 说明文字          |  |
| |   Textarea (rows=6, class="font-mono")             |  |
| |   flex justify-between:                            |  |
| |     [重置为预设 Button outline]  [储存 Button]     |  |
| +---------------------------------------------------+  |
|                                                        |
| +--[一般设定 Card]-----------------------------------+  |
| | CardHeader: "一般"                                 |  |
| | CardContent (space-y-4):                           |  |
| |   flex items-center justify-between:               |  |
| |     Label:"开机自动启动"  Switch                   |  |
| |   Separator                                        |  |
| |   flex items-center justify-between:               |  |
| |     Label:"自动更新"      Switch                   |  |
| +---------------------------------------------------+  |
+--------------------------------------------------------+
```

**关键元件：**

- 区块容器：每个设定区块使用 `Card` + `CardHeader` + `CardContent`
- 触发键选择：`Select` + `SelectTrigger` + `SelectContent` + `SelectItem`（依平台动态载入选项：macOS 为 Fn/Option/Ctrl/Cmd/Shift；Windows 为 右Alt/左Alt/Ctrl/Shift）
- 触发模式：`RadioGroup` + `RadioGroupItem`
- API Key 输入：`Input type="password"` + 显示/隐藏 `Button variant="outline" size="icon"`（`Eye` / `EyeOff` icon）
- API Key 状态：`Badge variant="outline"` 搭配 `bg-success/20 text-success`（已设定）或 `bg-destructive/20 text-destructive`（未设定）
- Prompt 编辑：`Textarea`（需安装 `npx shadcn-vue@latest add textarea`）
- 开关：`Switch`
- 区块分隔：`Separator`

**安装所需元件：**

```bash
npx shadcn-vue@latest add select
npx shadcn-vue@latest add radio-group
npx shadcn-vue@latest add textarea
npx shadcn-vue@latest add switch
npx shadcn-vue@latest add separator
```

## Dark Mode 配色调整

本应用预设 dark mode。以下是 `src/style.css` 中 `.dark` 区块的调整指引。

### 现有配色保留

shadcn-vue 的 `neutral` base color 的 dark mode 预设值已经过设计，大部分情况下直接使用。以下变数**不修改**：

- `--background`、`--foreground`（页面基底）
- `--card`、`--card-foreground`（卡片）
- `--popover`、`--popover-foreground`（下拉选单）
- `--muted`、`--muted-foreground`（次要色）
- `--secondary`、`--secondary-foreground`（次要操作）
- `--accent`、`--accent-foreground`（悬浮/选取）
- `--border`、`--input`（边框/输入框）

### Teal 品牌色 Dark Mode 调整

由 `--theme teal` 自动处理。Dark mode 下 `--primary` 使用 teal-500（较亮）取代 light mode 的 teal-600（较暗），确保在深色背景上的可读性。

### 状态色 Dark Mode 对照表

| 变数 | Light Mode | Dark Mode | 调整理由 |
|------|-----------|-----------|---------|
| `--success` | green-600 `oklch(0.59 0.145 163.225)` | green-500 `oklch(0.696 0.17 162.48)` | 深色背景需更亮 |
| `--warning` | orange-400 `oklch(0.75 0.183 55.934)` | amber-400 `oklch(0.828 0.189 84.429)` | 提高辨识度 |
| `--info` | blue-500 `oklch(0.623 0.214 259.815)` | blue-500 `oklch(0.623 0.214 259.815)` | 明度已足够 |
| `--destructive` | 已在 style.css 定义 | 已在 style.css 定义 | 不修改 |

### Dark Mode 对比度规则

- 文字对比度 >= 4.5:1（WCAG AA），`text-foreground` 在 `bg-background` 上已满足
- `text-muted-foreground` 对比度 >= 3:1（辅助文字可接受较低对比）
- 状态色背景（`bg-success`、`bg-warning`）上的文字使用对应 `*-foreground` 变数
- 边框使用 `oklch(1 0 0 / 10%)`（白色 10% 透明度），在深色背景上微妙可见
