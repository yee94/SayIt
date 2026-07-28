# Component Inventory — Frontend

> Vue 3 components · 自制元件 + shadcn-vue（new-york style）UI 库
> 扫描日期：2026-05-08 · root: `src/components/`

---

## 一、自制元件（11 个 · ~1.9 KLOC）

### 1.1 HUD 主元件

#### `NotchHud.vue`（861 LOC）
- **位置**：HUD 视窗主画面
- **职责**：根据 `useVoiceFlowStore.hudState.status` 切换 8 种 UI（idle / recording / transcribing / enhancing / editing / success / error / cancelled）；订阅 `audio:waveform` 显示波形动画；订阅 `vocabulary:learned` 显示「字典学习到」提示
- **依赖**：useVoiceFlowStore、useAudioWaveform composable

### 1.2 Dashboard 结构性元件

| 元件                      | LOC | 职责                                                                          |
| ------------------------- | --: | ----------------------------------------------------------------------------- |
| `AppSidebar.vue`          | 177 | Dashboard 侧边栏总成（用 shadcn-vue `SidebarProvider` + `Sidebar` + `SidebarMenu`） |
| `NavMain.vue`             |  57 | 侧边栏主导航（Dashboard / History / Dictionary / Settings）                   |
| `NavSecondary.vue`        |  41 | 侧边栏次要导航（Feature Guide）                                               |
| `NavDocuments.vue`        |  91 | 侧边栏文件区（外部连结）                                                      |
| `NavUser.vue`             | 114 | 侧边栏底部使用者区块 + 登出                                                   |
| `SiteHeader.vue`          |  15 | Dashboard 顶部                                                                |

### 1.3 Dashboard 内容元件

| 元件                          | LOC | 用于                              |
| ----------------------------- | --: | --------------------------------- |
| `SectionCards.vue`            | 106 | DashboardView 统计卡片             |
| `DashboardUsageChart.vue`     |  89 | DashboardView unovis 使用量图表    |

### 1.4 引导 / 教学元件

| 元件                      | LOC | 用于                                                  |
| ------------------------- | --: | ----------------------------------------------------- |
| `AccessibilityGuide.vue`  | 191 | macOS 辅助使用权限引导（必要权限说明 + 开启系统设定按钮） |

---

## 二、shadcn-vue UI 元件（21 个 · `src/components/ui/`）

> **强制使用，禁止手写替代品**。详见 `architecture-frontend.md` §10。

| 类别            | 元件                                                  | 用途                                            |
| --------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Layout / Container | `card`、`separator`、`sheet`、`tabs`               | 区块、分隔线、抽屉、页签                        |
| Form / Input    | `input`、`textarea`、`select`、`switch`、`checkbox`、`radio-group`、`label` | 表单元件                  |
| Navigation      | `sidebar`、`dropdown-menu`                            | 侧边栏、下拉选单                                |
| Feedback        | `alert-dialog`、`tooltip`                             | 对话框、Tooltip                                 |
| Display         | `avatar`、`badge`、`skeleton`、`table`                | 头像、标签、骨架屏、表格                        |
| Action          | `button`                                              | 按钮                                            |
| Chart           | `chart`                                               | 图表（依赖 unovis）                             |

### 元件 API 规范（必须遵守）

| 规则                          | 范例                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| **variant 优先**              | `<Button variant="destructive">` 而非 `<Button class="bg-red-500 text-white">`       |
| **Switch 绑定**               | `:model-value="..."` + `@update:model-value="..."` （**不是** `:checked`）           |
| **Select 绑定**               | `:model-value="..."` + `@update:model-value="..."`                                    |
| **Label 无障碍**              | `<Label for="api-key">` 对应 `<Input id="api-key">`                                  |
| **Badge variant**             | 用 `variant="secondary"` 等 prop，不用 class 覆盖整套样式                            |
| **RadioGroup 绑定**           | `:model-value` + `@update:model-value`，payload 为 `AcceptableValue`（需 runtime narrowing） |
| **RouterLink 在 Menu 中**     | `<SidebarMenuButton as-child><RouterLink>...</RouterLink></SidebarMenuButton>`       |

---

## 三、样式系统

### 3.1 必用语意色彩（Tailwind 4 + shadcn-vue 变数）

```
✅ bg-primary / text-primary / border-primary
✅ bg-card / text-card-foreground / border-border
✅ bg-muted / text-muted-foreground
✅ bg-accent / text-accent-foreground
✅ bg-destructive / text-destructive

❌ bg-zinc-900 / text-white / border-zinc-700
❌ bg-blue-500 / hover:bg-blue-600
```

### 3.2 元件样式覆盖准则

可微调：padding、size、间距、特定 emoji-only 变化
不可动：核心色彩、shadcn-vue 元件内部结构、variant 样式表

### 3.3 图示

**唯一允许**：`lucide-vue-next`

```vue
import { Mic, Settings, Trash2 } from 'lucide-vue-next';
<Mic class="size-4" />
```

**禁止**：`@tabler/icons-vue`（虽已安装，但仅为 dashboard-01 block 附带）

---

## 四、Composable 对应元件

| Composable                | 主要使用方                       | 用途                                         |
| ------------------------- | -------------------------------- | -------------------------------------------- |
| `useTauriEvents.ts`       | 全部（唯一 event API import）   | event constant + listen/emit re-export       |
| `useAudioWaveform.ts`     | `NotchHud.vue`                   | 订阅 `audio:waveform` 驱动波形 SVG            |
| `useAudioPreview.ts`      | `SettingsView.vue`               | 订阅 `audio:preview-level` 驱动音量条         |
| `useFeedbackMessage.ts`   | `MainApp.vue` / 各 view          | 短暂提示讯息（自动更新成功 / 失败 / 进行中等） |

---

## 五、views 与 components 的对应

```
DashboardView.vue
  ├─ SectionCards
  └─ DashboardUsageChart

HistoryView.vue
  └─ shadcn-vue: Table、Input、Button、DropdownMenu、Tooltip

DictionaryView.vue
  └─ shadcn-vue: Table、Input、Button、AlertDialog

SettingsView.vue（1907 LOC，最大 view）
  ├─ AccessibilityGuide
  └─ shadcn-vue: 全部表单元件 + Tabs + Sheet

FeatureGuideView.vue
  └─ shadcn-vue: Card

MainApp.vue（Dashboard root）
  ├─ AppSidebar
  │   ├─ NavMain
  │   ├─ NavDocuments
  │   ├─ NavSecondary
  │   └─ NavUser
  └─ SiteHeader

App.vue（HUD root）
  └─ NotchHud
```

---

## 六、设计流程强制（不可跳过）

> **❌ 未经设计直接实作 UI** → ✅ **先用 Pencil MCP 完成 `design.pen` 设计稿**

新 UI 功能必须走：
1. 在 `design.pen` 完成视觉设计（Pencil MCP `batch_design`）
2. 跟使用者对齐设计稿
3. 才开始实作 Vue 元件
4. 实作后对照设计稿微调

> 详见 `_bmad-output/planning-artifacts/ux-ui-design-spec.md`。
