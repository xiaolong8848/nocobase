# v2 中是否可以用 AI 写前端页面（依据 nocode.docs.nocobase.com）

> 日期：2026-11-24
> 依据：官方文档 + 本地 v2.2.51 源码 + 已安装技能集核查

---

## 0. 结论

**可以，但要区分两种"AI 写页面"，且存在一个版本对应问题需要先厘清。**

官方文档（nocode.docs.nocobase.com）明确提供 **AI Builder**，即用自然语言让 AI 构建业务系统，包含写页面。它有两条路径：

| 路径 | 入口 | 页面来源 | 产物 | 适合 |
|---|---|---|---|---|
| **AI + no-code Portal** | `/v/<name>` | 在界面配置，AI 帮改配置 | 配置存数据库 | 标准 CRUD、内部后台 |
| **AI Portal** | `/x/<name>` | AI 在本地写 **React 源码** | 可提交 Git 的源码 | 定制交互、复杂系统、视觉要求高 |

两者共享同一套数据/权限/工作流 Skills，且可在同一应用里混用。

---

## 1. 版本对应问题（关键）

| 来源 | 说法 |
|---|---|
| 本地源码 | `v2.2.51`（NocoBase 2） |
| AI Portal 官方前置条件 | **NocoBase >= 3.0.0-alpha.6** + alpha CLI + pnpm |
| 已安装技能集 | 全部标注 **"NocoBase 2 only; never use in a NocoBase 3 project"** |
| UI Configuration 文档 | "Cannot handle non-modern page (v1) navigation, **only supports v2 pages**" |

存在明显的版本/术语错位：

- 文档里的"v2 pages"指 **modern 页面**（相对 v1 legacy）
- 但 AI Portal 作为产品特性要求 **NocoBase 3.x**
- 本地 v2.2.51 源码中**没有** AI Portal / portalType / `/x/` 的实现（已全仓库验证 = 0 匹配）

**因此：你当前本地的 v2.2.51 代码库本身不提供 AI Portal 能力**；AI Portal 属于 NocoBase 3。

---

## 2. 但我本地已安装技能集具备"AI 写 v2 页面"能力

已安装的 NocoBase 技能集（位于 `/Users/xiaolong/.agents/skills/`）正好覆盖 AI Builder：

| 技能 | 用途 |
|---|---|
| `nocobase-portal-manage` | 所有 UI 构建请求的入口，解析 Portal（primary entry） |
| `nocobase-ui-builder` | no-code Portal 页面/区块/字段/动作构建；通过 `nb api flow-surfaces apply-blueprint` 写配置；**"only supports v2 pages"** |
| `nocobase-ai-builder` | AI Portal 源码开发（portalType='ai' 时强制使用） |
| `nocobase-data-modeling` / `nocobase-acl-manage` / `nocobase-workflow-manage` | 数据表、权限、工作流 |

验证：本地 `nocobase-ui-builder/SKILL.md:43` 明确写有 `applyBlueprint` / `nb api flow-surfaces apply-blueprint`——这正是 AI 写 v2 页面的写路径。

而本地 v2.2.51 源码中 `plugin-flow-engine/src/server/flow-surfaces/` 确实存在这套 authoring 编译器（apply-blueprint 校验规则、blueprint-contract 测试等）。**说明 v2 页面（modern）的 AI 配置写入能力在本地源码是有实现基础的。**

---

## 3. 两种路径的详细对比

### 路径 A：AI + no-code Portal（AI 改配置）
- AI 通过 `flow-surfaces` API 生成页面蓝图（apply-blueprint），产物是数据库配置
- 页面跑在 v2 的 FlowEngine（`TableBlockModel`、通用路由、FlowModel 树）——正是前面分析的表格区块所在
- 业务用户后续可在界面里继续调整
- 局限：受区块能力约束，复杂交互/视觉定制力不从心

### 路径 B：AI Portal（AI 写源码）
- NocoBase 提供内核（认证、数据、权限、API、工作流）
- AI Agent 在 `portal-template-default`（React 19 + Vite + Refine + shadcn）里写前端代码
- `nb portal pull/dev/push/deploy` 管理源码，产物可提交 Git
- 需要 **NocoBase 3.x + alpha CLI**

---

## 4. 实践建议

1. **确认你的实际运行环境版本**：
   - 若是 NocoBase 2.x（如本地 v2.2.51）：用路径 A（no-code Portal，AI 改配置），技能 `nocobase-ui-builder` 可用
   - 若是 NocoBase 3.x：两条路径都可用，复杂页面推荐路径 B（AI Portal 源码）
2. **对表格性能项目的关联**：AI 写的 v2 页面用的就是当前分析的表格区块——所以表格渲染性能直接影响 AI 生成页面的体验，重构收益会传导到 AI 构建场景
3. **不要混淆**：本地 v2.2.51 源码里没有 AI Portal 实现；若要在 AI Portal 写代码，需要 NocoBase 3 环境

---

## 5. 最终回答

**Q：v2 中是否可以使用 AI 写前端页面？**

**A：可以，但需分情况：**
- 在 **NocoBase 2.x**（本地 v2.2.51）：可通过 **AI + no-code Portal** 让 AI 写/改 v2 页面配置（flow-surfaces），技能已装、源码有实现基础
- **AI Portal（AI 直接写 React 源码）** 是 **NocoBase 3.x** 特性，本地 v2.2.51 不具备

两种模式官方都支持，且推荐"内部后台用 no-code、客户门户用 AI Portal"混用。下一步若要在你本地 v2.2.51 上实际用 AI 写页面，可走 `nocobase-portal-manage → nocobase-ui-builder` 流程（需连接到运行中的 NocoBase 实例）。
