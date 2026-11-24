# 替换 antd 表格为 TanStack Table / Tabulator 的可行性

> 分支：`perf/table-block-refactor`　|　日期：2026-11-24
> 依据：本地 v2.2.51 源码核查 + 前面 A/B/C 分析

---

## 0. 结论

**不建议替换。** 分两层看：

1. **「替换整个 antd 前端」不可行**——antd 在 client-v2 中有 **214 个文件**使用（占 858 个源文件约 25%），涵盖 Button(48)、Space(46)、Input(39)、Select(33)、Form(16)、DatePicker(11)、Modal/Drawer/Popover 等全组件体系。替换 antd = 重写整个前端，远超表格性能目标。
2. **「只替换表格组件」为 TanStack/Tabulator** = 方案 C，技术上可行但性价比极差，且不解决主导性能瓶颈。

---

## 1. 当前仓库状态（已核查）

| 库 | 声明位置 | 源码 import | 说明 |
|---|---|---|---|
| `@tanstack/react-table ^8.21.3` | 仅 `packages/core/client/package.json:36`（**v1** client） | **0 处** | v1 的死依赖，client-v2 无声明 |
| `tabulator-tables ^6.3.1` | 仅 `packages/core/client/package.json:82`（v1） | **0 处** | 同上 |
| `rc-virtual-list` | antd 传递依赖 | 经 antd 使用 | 唯一现成虚拟化能力 |

**结论**：两个库在 v2 里都是"从没用过"的状态，引入等于全新集成，无现成代码可复用。

---

## 2. 为什么替换不解决核心问题

前面已确认 v2 表格的主导瓶颈是：
1. 每格 `createFork` + `defineProperty` + 闭包 + `useApplyAutoFlows`（`TableColumnModel.tsx:336-385`）
2. props 不稳定导致 `React.memo` 失效（`TableBlockModel.tsx:685-700`）
3. fork 缓存无 dispose（`flowModel.tsx:1384-1412`）

**这三个问题都在 NocoBase 自己的代码里，与 antd Table 无关。** 换表格引擎：
- ✅ 可能改善：antd reconcile 的 DOM 层开销（约 10–20%）
- ❌ 不改善：每格 fork/hook（主导成本）、props 失效、appends/N+1
- ⚠️ TanStack 是 headless（无 DOM、无虚拟滚动、无 ACL、无 Formily），要重写渲染层、虚拟滚动（需额外装 `@tanstack/react-virtual`）、设计器集成、ACL、拖拽、编辑、树表——工作量 12–20+ 周
- ⚠️ Tabulator 自带虚拟滚动，但 DOM/CSS 体系独立、与 React 集成靠 wrapper、视觉风格与现有 antd/NocoBase 不一致，同样不解决每格 fork

---

## 3. 若要替换表格组件，必须保留的契约

| 契约 | 位置 | 依赖方 |
|---|---|---|
| `use:'TableBlockModel'`、`subModels.columns`、flow step keys | `TableBlockModel.tsx:765-968` | 服务端 flow-engine 275 处字符串、持久化 |
| `X-With-ACL-Meta` 请求头 | `:270-274` | `with-acl-meta.ts:32-40`、ACL 字段白名单 |
| `TableColumnModel` 类身份 | `TableColumnModel.tsx` | file-manager/map 的 instanceof、text-copy 猴补丁 |
| 单元格 fork / record 上下文 | `:336-385` | 字段表达式、行操作、linkage 规则 |
| 设计器集成 | `:178-204,624-684` | AddFieldColumn、renderConfigureActions、FlowSettingsButton、DndProvider |
| 行选择/拖拽/树展开/行内编辑 | `:508-547,316-423,1092-1132` | export/bulk/workflow 插件、交互 |

绕开这些契约 = 功能回归；保留它们 = 大部分渲染逻辑仍要用 NocoBase 的方式写，换引擎省不了多少。

---

## 4. 决策

| 方案 | 工作量 | 收益 | 风险 | 建议 |
|---|---|---|---|---|
| 原地 props 稳定 + fork 生命周期（FINAL-DECISION §3） | 1.5–2.5 周 | 交互 60–80%、首屏 40–60% | 极低（零契约变更） | ✅ **首选** |
| 定点虚拟（仅重写 3 个 body 组件） | +2–4 周 | 挂载 cell 减少 85%+ | 中（虚拟兼容矩阵） | ⚠️ 仅大数据量时 |
| 换 TanStack / Tabulator | 12–20+ 周 | DOM 层 10–20%，主导成本不变 | 高（契约/ACL/设计器） | ❌ 不建议 |
| 替换整个 antd | 重写整个前端 | — | 极高 | ❌ 完全不可行 |

---

## 5. 一句话回答

**Q：是否可替换 antd 前端，用 TanStack Table / Tabulator 等性能更优组件？**

**A：技术上可以换表格组件，但不建议——它们不解决 NocoBase 自身的每格 fork / props 失效瓶颈，只动 10–20% 的 DOM 层，却要 12–20+ 周并重做全部契约。替换整个 antd 更不可行（214 文件在用）。正确路径是先做原地 props 稳定 + fork 生命周期修复（1.5–2.5 周，零契约风险），把预算留给真正有效的定点虚拟。**
