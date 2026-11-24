# v1 表格性能优化可行性

> 分支：`perf/table-block-refactor`　|　日期：2026-11-24
> 背景：此前决策聚焦 v2。本文评估 v1 是否也能改善，作为策略补充

---

## 0. 结论

**可以改善，而且历史已经证明——但投入产出比低于 v2，且受多重约束。**

- ✅ **已证明**：官方 PR #5438「首屏渲染降低约 50%」、PR #6888「页面越用越慢」优化，都打在 v1 表格上
- ✅ **剩余空间大**：v1 有多个明确的、代码级的性能缺陷（死代码、危险依赖、每格 Formily Schema 创建）
- ⚠️ **约束更多**：深度耦合 Formily 私有 API、设计器原地 schema 变更、31 个插件依赖（8 个高风险）、无虚拟化基础
- ⚠️ **战略劣势**：v1 是 legacy，官方主推 v2（`/v/`），长期维护价值低

**建议**：若仍有大量 v1 页面在用，做**低风险定点优化**（1–2 周）即可；**不要做 v1 重构**——同样的钱花在 v2 上收益更高。

---

## 1. v1 已有的优化（不要重复做）

`Table.tsx` 里已有大量性能工作（前面审计确认）：
- `React.memo` on header wrapper/cell、row、cell components（`:609-641, :645-731`）
- `HighPerformanceSpin` 替代 `Table loading`（`:1224-1226`）
- 固定 `BlockRequestLoadingContext.Provider value={false}`（`:1229-1231`）
- 条件渲染 `GetStyleRules`（`:687-709`）
- memoized `components`/`scroll`/`rowSelection`/`onRow`（`:1072-1198`）

历史优化成果：PR #5438（首屏 -50%）、PR #6888（越用越慢）。

---

## 2. v1 剩余缺陷（已核查代码）

| # | 缺陷 | 位置 | 风险 |
|---|---|---|---|
| V1-1 | `optimizeTextCellRender` 是**死代码**——声明于 `:174,755`、进 memo 依赖 `:303`、设置于 `useTableBlockProps.tsx:70`，但渲染体 `:264-278` 从不读取 | `Table.tsx:174,264-278,303,755` | 低（实现快路径有 ACL/联动约束） |
| V1-2 | `columnsSchemas` 无 `useMemo`，但有中文注释说明"设计器原地改 schema"——不能简单加 memo（会冻结设计器编辑） | `Table.tsx:185-192` | 中（需按 schema version 稳定化） |
| V1-3 | `JSON.stringify(...)` 当依赖：pagination `:470-473`、rowSelection `:1086`（会丢弃函数，handler 陈旧）、getRowKey `:1036`、rowClassName `:1200` | 多处 | 低 |
| V1-4 | 每格 `new Schema(schema)` + 合并 schema（Formily 递归） | `NocoBaseRecursionField.tsx:274-277,309-320` | 高（Formily 承重） |
| V1-5 | SubTable 每格无条件跑 linkage hook（主表有 `!_.isEmpty(styleRules)` 门控，副本没有） | `association-field/Table.tsx:487-509` vs `Table.tsx:700-703` | 低 |
| V1-6 | 行选择 hack：`BodyRowComponent` 用 `_.isEqual` 深比较 style，且**返回 stale children**（React 18 并发下不安全） | `Table.tsx:660-683` | 中 |
| V1-7 | 窗口 resize 触发整表重渲染（测出的 `tableWidth` 根本没用） | `useBlockSize.ts:179-204` + `Table.tsx:1192` | 低 |
| V1-8 | 官方 TODO：`columnField.form.query(...)` 在 M2 Pro 上单行约 0.1ms | `Table.Column.Decorator.tsx:61` | 中 |
| V1-9 | **无虚拟化**——v1 完全没有 `virtual` prop，`scroll.x='max-content'` | `Table.tsx:863-878,1193-1198` | 高（需重写 Formily 单元格） |

---

## 3. 改善路径（按风险分级）

### 低风险（1–2 周，推荐做）
- **V1-1**：实现 `optimizeTextCellRender` 快路径——纯文本格绕过 `NocoBaseRecursionField`，但必须保留 ACL 白名单、联动样式、省略提示（对照 `Table.tsx:188,687-709`）
- **V1-3**：把 `JSON.stringify` 依赖换成结构化 comparator/useDeepCompare
- **V1-5**：SubTable 给 linkage hook 加 `styleRules` 门控（照抄主表）
- **V1-7**：resize 不触发无用的 tableWidth 更新（或让 Table 用上它）

### 中风险（2–4 周，谨慎）
- **V1-2**：`columnsSchemas` 按 schema uid/version 稳定化（不能纯引用 memo）
- **V1-6**：用真正的 `React.memo` 行组件替换 `_.isEqual` + stale children hack
- **V1-8**：缓存 `form.query` 结果

### 高风险（不建议，≥6 周）
- **V1-4**：去 Formily 单元格——破坏子表、可编辑表格、联动、设计器
- **V1-9**：v1 虚拟化——需同时重写 Formily 每格组件 + 三个 body 组件

---

## 4. 插件兼容性约束（比 v2 严重）

v1 表格契约被 **31 个插件 / 83 个文件**依赖，其中 8 个高风险：
- `plugin-gantt`：改写私有 table context（`field.onExpandClick`/`onRowSelect`）
- `plugin-departments`：自行构造 `TableBlockContext.Provider`
- `plugin-client`：提供被其他插件引用的 `useTableBlockProps`
- `plugin-block-template` / `plugin-audit-logs`：把整套 schema 语法编码进业务逻辑
- `plugin-mobile`：CSS 硬编码 `.ant-table-thead [aria-label*="schema-initializer-TableV2-..."]`

**只要保持 schema key（`x-component: TableV2`、`table:configure*`、`blockSettings:table`）和 context 形状不变，低风险改动基本兼容。**

---

## 5. 与 v2 的对比

| 维度 | v1 优化 | v2 优化（已定方案） |
|---|---|---|
| 已有优化基础 | 多（PR #5438/#6888） | 有（React.memo 等） |
| 剩余缺陷明确度 | 高 | 高 |
| 插件耦合 | 31 插件（8 高风险） | 较少（Gantt + flow-engine 服务端） |
| Formily 承重 | 是（私有 API） | 否（FlowEngine，但每格 fork） |
| 虚拟化可行性 | 低（要先重写 Formily 格） | 中（重写 3 个 body 组件） |
| 长期价值 | 低（legacy） | 高（官方主推） |
| 建议投入 | 低风险定点（1–2 周） | 主力（Phase 1–3） |

---

## 6. 最终建议

**Q：v1 的表格性能可以改善吗？**

**A：可以，且有历史证明（PR #5438 首屏 -50%）。但 v1 是 legacy，插件耦合更重、无虚拟化基础、长期价值低。**

- 若仍有大量 v1 页面在用：**只做低风险定点优化**（死代码快路径、JSON.stringify 依赖、SubTable 门控、resize 重渲染，1–2 周），不要碰 Formily 承重部分和虚拟化
- 若目标是长期：把预算放在 v2（已定的 Phase 1–3 方案），同样的钱收益更高
- 不要做 v1 重构——历史优化已经吃掉大头，剩下的都是高成本低收益的硬骨头

---

### 证据索引
- `Table.tsx:174,264-278,303,755`（optimizeTextCellRender 死代码）
- `Table.tsx:185-192`（columnsSchemas 无 memo + 设计器约束注释）
- `Table.tsx:660-683`（行选择 hack）、`:470-473,1036,1086,1200`（JSON.stringify 依赖）
- `association-field/Table.tsx:487-509` vs `Table.tsx:700-703`（SubTable linkage 门控缺失）
- `useBlockSize.ts:179-204` + `Table.tsx:1192`（resize 无用重渲染）
- `Table.Column.Decorator.tsx:61`（官方 0.1ms TODO）
- PR #5438 / #6888（历史优化成果）
