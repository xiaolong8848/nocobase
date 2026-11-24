# v2 低代码页面与 AI Portal 页面：共通路由与单一入口整合分析

> 分支：`perf/table-block-refactor`　|　日期：2026-11-24
> 依据：本地 v2.2.51 源码全量审计 + NocoBase 官方 Portal 文档（2026-07 verified）

---

## 0. 结论先行

**严格意义上的「共通路由」（同一路由表渲染两类页面）不成立，因为二者根本不在同一代产品、不是同一套前端。**

- 你本地的 **v2.2.51** 是 **NocoBase 2** 开源核心
- **AI Portal 是 NocoBase 3 的特性**（官方前置条件 `NocoBase >= 3.0.0-alpha.6`），是独立的 React 19 + Vite + Refine + shadcn/ui 前端项目，部署在 `/x/<portal>/`；no-code Portal 用 `/v/`
- 当前安装的 nocobase 技能集标注 **"NocoBase 2 only; never use in a NocoBase 3 project"** —— 与 AI Portal 文档要求 NocoBase 3 存在**版本矛盾**，需先确认目标环境

**但「从一个入口整合」是可以做到的**，属于网关/导航层整合，而非路由表合并。

---

## 1. 关键事实核对

### 1.1 本地 v2.2.51 里不存在 AI Portal（全仓库审计确认）

| 检查 | 结果 |
|---|---|
| `AI Portal` / `portalType` 字面量 | **0 处**（含 docs / CHANGELOG / locales） |
| multi-portal 插件源码 | **不存在**（`presets/.../multiPortal.test.ts:23-27` 明确断言默认 preset 不含 `@nocobase/plugin-multi-portal`） |
| `/x/` 路由 | 无 |
| AI page model / AI route type | 无（路由类型枚举 `routeTypes.ts:10-17` 为 `group/page/flowRoute/link/tabs/flowPage`，无 `ai`） |

plugin-ai 实际提供的是**普通低代码页面内的 AI 能力**：
- AI chat box **区块**（`AIChatBoxBlockModel extends BlockModel`，`block/ai-chat-box/AIChatBoxBlockModel.tsx:29`）——通过"添加区块 → 其他区块"加到普通页面，是**区块不是页面**
- 全局浮动聊天面板（`ChatBoxLayout.tsx:113-155`）——overlay
- 设置页（AI 员工 / LLM 服务 / MCP）——配置界面，非内容页面

**所以在 v2.2.51 里，没有"AI Portal 页面"这个东西可以拿来共通路由。**

### 1.2 v2 低代码的路由本质：一个通用入口 + 视图栈

| 事实 | 证据 |
|---|---|
| `RouterManager` 无 `pageType`/`mode` 判别器，路由只是通用 `RouteType` | `RouterManager.tsx:50-55,155` |
| 每个 layout 注册 5 条通用路由（`:name` = 页面 uid） | `LayoutManager.tsx:145-184` |
| `FlowRoute` 运行时把 uid 解析成持久化 `FlowModel` 树 | `FlowRoute.tsx:241-475` |
| "模式"是视图栈：embed/drawer/dialog/popover 四种，共存于同一路由，mode 编码进 URL | `FlowView.tsx:23-36`、`provider.tsx:39-60`、`ViewNavigation.ts:61-103` |

**结论：v2 低代码内部天然就是"一个入口整合多种页面形态"**——但这是 FlowEngine 视图栈层面的整合，与 AI Portal 无关。

### 1.3 AI Portal 的路由本质：独立前端应用

根据官方文档：

| 维度 | AI Portal |
|---|---|
| 技术栈 | React 19 + TypeScript + Vite + **Refine** + Tailwind 4 + shadcn/ui + pnpm |
| 路由 | `src/app/routes.tsx` 用 `defineAppRoutes` + `lazy`；Refine `resource` 决定菜单 |
| 源码 | `@nocobase/portal-template-default`，本地源码工程 |
| 部署路径 | `<appPublicPath>/x/<portal>/`（no-code Portal 用 `/v/`） |
| 生命周期 | `nb portal create/pull/dev/push/deploy` |
| 数据 | 通过 `NOCOBASE_API_URL=/api` 调 NocoBase REST API（纯前端） |

---

## 2. 能否共通路由：技术障碍分析

| 层面 | 能否共享 | 原因 |
|---|---|---|
| React Router 实例 | ❌ | 两个独立应用，两个 bundle，两个 RouterProvider |
| 路由表 | ❌ | v2 路由表在 `RouterManager.routes`（内存 + desktopRoutes 表）；Portal 路由在 `routes.tsx`（源码），彼此不可见 |
| 页面渲染运行时 | ❌ | v2 页面 = 持久化 FlowModel 树（需 FlowEngine + OJET/antd）；Portal 页面 = Refine + shadcn 源码组件 |
| 组件库 | ❌ | antd/OJET vs shadcn/Tailwind |
| 构建系统 | ❌ | rsbuild vs Vite |
| 认证/权限 | ⚠️ 共享 | 同一 NocoBase 账号体系与角色（Portal 权限需单独配置） |
| 数据/API | ✅ 共享 | 同一后端 REST API |
| 域名/端口 | ✅ 可共享 | 都在 appPublicPath 下，靠 `/v/` vs `/x/` 前缀区分 |

**决定性障碍**：两种页面**无法互相渲染**——v2 的 FlowModel 树不能被 Refine 应用解释，Portal 的 React 组件也不能被 FlowEngine 当普通 block 加载（除非大量定制适配层）。

---

## 3. "从一个入口整合"的三条路径

### 路径 A：网关层统一（推荐，成本最低）

- 保持两套前端独立构建部署，同域名下 `/v/`（低代码）与 `/x/<portal>/`（AI Portal）并存
- 用一个统一导航页/工作台，链接到两个入口；或由 gateway 根据路径前缀路由到不同 dist
- 优点：零侵入、各自升级独立；缺点：用户可能感知到跳转/两套 UI 风格

### 路径 B：Portal 内嵌 v2 页面 / 反向内嵌

- 在 AI Portal 里用 iframe 嵌入 `/v/admin/...` 页面（或反向）
- 需处理：SSO token 传递、双层布局、滚动/尺寸、ACL 一致性
- 优点：表面单一入口；缺点：体验割裂、维护复杂

### 路径 C：真正的单一前端（重构级）

- 方案 C1：在 AI Portal（Refine）里实现 FlowModel 渲染器，把 v2 页面当动态路由渲染 —— 需把 FlowEngine + OJET/antd 引入 Refine 应用，技术栈冲突严重
- 方案 C2：在 v2 低代码里实现 Portal SDK 容器，把 Portal 页面当特殊 block 加载 —— 同样需跨栈适配
- 优点：真正统一；缺点：工作量极大，且违背两套前端各自的设计初衷，**不建议**

---

## 4. 必须先澄清的版本矛盾

| 来源 | 说法 |
|---|---|
| 本地仓库 | v2.2.51（NocoBase 2） |
| AI Portal 官方文档 | 需要 NocoBase >= 3.0.0-alpha.6 |
| 已安装 nocobase 技能集 | "NocoBase 2 only; never use in a NocoBase 3 project" |

**这意味着**：如果你要的是真正的 AI Portal（NocoBase 3 特性），当前 v2.2.51 分支不是合适的基座；如果你要用 v2.2.51，那么"AI Portal 页面"在当前代码库里不存在，最接近的是"AI chat box 区块 + 全局浮动助手"，它们本来就在普通低代码页面里，不存在跨栈整合问题。

---

## 5. 最终建议

1. **先确认目标环境**：v2.2.51（当前源码）还是 NocoBase 3 + AI Portal？这是所有后续决策的前提
2. **如果留在 v2.2.51**：没有 AI Portal 页面，AI 以区块/浮窗形式存在于普通页面——"整合"问题不存在，直接用即可
3. **如果要 AI Portal**：它是 NocoBase 3 的独立前端，走网关层统一入口（路径 A）是唯一低成本方案；不要试图合并路由表或互相渲染页面
4. **不要在 v2 分支上做跨栈整合**：两套前端技术栈、构建、路由、组件库全不同，强行统一得不偿失

---

### 证据索引
- `RouterManager.tsx:50-55,155,274-323,357-418`
- `LayoutManager.tsx:145-184`
- `FlowRoute.tsx:241-475`
- `FlowView.tsx:23-36,82-110`、`provider.tsx:39-60`
- `ViewNavigation.ts:61-103`
- `routeTypes.ts:10-17`
- `plugin-ai/client-v2/plugin.tsx:61-110,137-158`
- `block/ai-chat-box/AIChatBoxBlockModel.tsx:29,61-78`
- `ChatBoxLayout.tsx:113-155`
- NocoBase 官方文档：AI Portal Quick Start / Deployment and Source Management / Project Structure and Tech Stack / Multi-portal
