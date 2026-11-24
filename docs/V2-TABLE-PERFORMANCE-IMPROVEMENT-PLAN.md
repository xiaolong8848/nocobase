# v2 表格区块性能优化 — 完整改进方案

> 分支：`perf/table-block-refactor`　|　基于：v2.2.51 (74cba858)
> 范围：仅 `@nocobase/client-v2` + FlowEngine，**不换 antd、不改 v1、不重构表格区块架构**
> 目标：在不变更任何持久化契约的前提下，消除 v2 表格的三个主导性能缺陷

---

## 1. 方案总览

### 1.1 三个主导缺陷（已定位到代码）

| # | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| D1 | `pagination()` / `selectedRowKeys` 每次渲染新建对象 → `HighPerformanceTable` 的 `React.memo` 永不 bail out | `TableBlockModel.tsx:572-614,685-700,970-1035` | 任何 observer 重渲染都触发整表 reconcile |
| D2 | 每单元格 `createFork` + `createRecordMetaFactory` + `defineProperty`×2 + 闭包 + 每格 `useApplyAutoFlows`/`useRequest` | `TableColumnModel.tsx:336-385` | 200×10 表 = 2000 格，首屏最重成本 |
| D3 | fork 缓存按行 key 存储且**无 dispose**，翻页/滚动无界增长 | `flowModel.tsx:1384-1412`，key 在 `TableColumnModel.tsx:341` | 内存泄漏 + 越用越慢 |

### 1.2 不变量（Absolute Constraints — 改动绝不能碰）

以下契约一旦变更，会破坏服务端 275 处字符串引用、Gantt 子类、插件 instanceof 检查、ACL：

- `use: 'TableBlockModel'` / `use: 'TableColumnModel'` 序列化类名
- `subModels.columns` / `subModels.actions` 子模型结构
- `tableSettings` 全部 flow step keys、`resourceSettings.init`、`resourceSettings2`
- `createResource()` 的 `X-With-ACL-Meta` 请求头（`TableBlockModel.tsx:270-274`）
- `TableColumnModel` 类身份（file-manager/map 的 `instanceof`、text-copy 猴补丁依赖）
- `rowClick` 事件与 `clickedRowRecord` 上下文属性
- 88 行 action 工具栏、`pagination()` 的移动端/未知总数逻辑（只能包装，不能删除）

### 1.3 分阶段

| 阶段 | 内容 | 工作量 | 风险 |
|---|---|---|---|
| Phase 0 | 建立可复现的基线测量 | 2–3 天 | 无 |
| Phase 1 | D1 修复：props 稳定化 + memo 生效 | 1 周 | 低 |
| Phase 2 | D3 修复：fork 生命周期治理 | 2–3 天 | 低 |
| Phase 3 | D2 修复：单元格静态快路径（在共存块验证后合入） | 2–3 周 | 中 |
| Phase 4 | 定点虚拟（仅当 Phase 1–3 后仍不达标，按需） | +2–4 周 | 中 |

**默认交付 Phase 0–2（约 2 周）**，Phase 3 视 Phase 0 基线决定是否启动，Phase 4 为可选项。

---

## 2. Phase 0 — 基线测量

### 2.1 场景固定
- 数据集：200 行 × 10 列（含 2 个关联字段、1 个日期、1 个状态）、500 行 × 10 列、50 行 × 20 列
- 操作：首屏渲染、滚动、勾选、翻页、刷新

### 2.2 采集指标
| 指标 | 采集方式 |
|---|---|
| 首屏渲染耗时 | React Profiler `<Profiler>` 包裹 `FlowRoute` |
| 提交次数 / 单次提交耗时 | React Profiler `onRender` |
| DOM 节点数 | `document.querySelectorAll('.ant-table-cell').length` |
| fork 缓存大小 | `model.subModels.columns[*]` 的 `forkCache.size` 聚合（调试钩子） |
| 请求数 | `network.list` 过滤 `/api/` |
| 交互卡顿 | Performance 面板 Long Tasks |

### 2.3 退出条件
拿到每个场景的 before 数值，写入 `docs/perf-baseline.md`，作为 Phase 1–3 的验收基准。

---

## 3. Phase 1 — D1：props 稳定化（核心，1 周）

### 3.1 `pagination()` 按依赖 memo 化

**文件**：`packages/core/client-v2/src/flow/models/blocks/table/TableBlockModel.tsx:572-614`

**现状**：`pagination()` 每次调用都新建 `result` 对象，并内联创建 `showTotal` / `itemRender` 函数。

**改法**：新增一个 `usePaginationProps` hook（或在 `HighPerformanceTable` 内用 `useMemo` 按原始值派生），依赖只取原始标量：
- `totalCount` = `resource.getMeta('count')`
- `pageSize` = `resource.getPageSize()`
- `current` = `resource.getPage()`
- `hasNext`、`dataLength`、`isMobileLayout`、`themeToken.controlHeight`

关键：`showTotal` 和 `itemRender` 必须来自闭包外的稳定引用或按上述依赖 memo，不要每次新建函数。

**注意**：`pagination()` 是 model 方法，不能直接用 hooks。推荐做法是在 `TableBlockContent`（函数组件）里调用一次并 `useMemo` 缓存，再把结果传给 `HighPerformanceTable`：

```tsx
// TableBlockContent 内
const paginationValue = useMemo(
  () => model.pagination(),
  [model, model.resource.getMeta('count'), model.resource.getPageSize(),
   model.resource.getPage(), model.resource.getMeta('hasNext'),
   model.resource.getData()?.length, isMobileLayout, themeToken.controlHeight]
);
```

> 依赖里直接调 getter 不稳定；更稳妥的是在 model 上暴露一个 `paginationSignature()` 返回原始标量元组，用 `useMemo(() => model.pagination(), [signature 各项])`。

### 3.2 `selectedRowKeysFromResource` 稳定化

**现状**（`:693-695`）：
```tsx
selectedRowKeysFromResource={this.resource
  .getSelectedRows()
  .map((row) => getRowKey(row, this.collection.filterTargetKey))}
```
每次 render 新建数组。

**改法**：在 `HighPerformanceTable` 内部（`:1000-1010`）已经用 `useEffect` + `_.isEqual` 做了内容比较，但**传入的新数组引用会先让 memo 失效**。应在 `TableBlockContent` 层用内容 key 稳定化：

```tsx
const selectedRows = model.resource.getSelectedRows();
const selectedKeySignature = selectedRows.map(r => getRowKey(r, filterTargetKey)).join('|');
const selectedRowKeysFromResource = useMemo(
  () => selectedKeySignature ? selectedKeySignature.split('|') : [],
  [selectedKeySignature]
);
```

### 3.3 `TableBlockContent` 加 `React.memo`

**文件**：`TableBlockModel.tsx:706`（`const TableBlockContent = (props) => ...`）

```tsx
const TableBlockContent = React.memo((props: {...}) => { ... });
TableBlockContent.displayName = 'TableBlockContent';
```

配合 3.1/3.2 的稳定 props，`React.memo` 才能真正 bail out。

### 3.4 `tableScroll` 已 memo（确认保持）

`TableBlockContent.tsx:740-743` 已有 `useMemo`，依赖 `[scrollY, dataSource?.length]`，保持不动。但要注意 `dataSource` 本身若每次新建，`dataSource?.length` 不变时 memo 仍有效——OK。

### 3.5 `mergedColumns` 稳定化

**文件**：`TableBlockModel.tsx:1037-1038`
```tsx
const leftAuxiliaryColumn = enableRowSelection ? null : model.getLeftAuxiliaryColumn();
const mergedColumns = leftAuxiliaryColumn ? [leftAuxiliaryColumn, ...columns] : columns;
```
`getLeftAuxiliaryColumn()`（`:468-506`）每次返回新对象带新 render 闭包。改为：
- `getLeftAuxiliaryColumn` 内部用 `useMemo` 等价的缓存（model 层用 `observable.ref` 字段 + 依赖签名），或
- 在 `HighPerformanceTable` 内 `useMemo(() => ..., [enableRowSelection, columns])`，并让 `getLeftAuxiliaryColumn` 只依赖稳定输入

### 3.6 Phase 1 验收
- 同一基线场景，勾选/高亮/刷新操作的 Profiler 提交次数下降 ≥ 50%
- Long Tasks 数量下降

---

## 4. Phase 2 — D3：fork 生命周期治理（2–3 天）

### 4.1 问题机理
`flowModel.tsx:1384-1412` 的 `createFork(key)`：
```ts
if (key) {
  const cachedFork = this.forkCache.get(key);
  if (cachedFork && !cachedFork.disposed) { cachedFork.setProps(...); return cachedFork; }
}
```
key 形如 `${record.__index || index}_${rowKey}`（`TableColumnModel.tsx:341`），翻页后旧 key 永不清理 → forkCache 无界增长。

### 4.2 改法（两种，按风险选）

**方案 2a（最小改动，推荐）**：在 `TableColumnModel` 里复用现有 `dispose` 机制。检索 `disposeAutorun`（`TableBlockModel.tsx:249-250,265-268`）和 `TableActionsColumnModel.tsx:81-96` 的 identity guard——后者是表格代码里**唯一**已有的 fork 缓存守卫，照此形状推广：

```ts
// 在 cell fork 前用行身份做 guard（伪码，需按真实 API 调整）
const identityKey = `${collectionName}:${filterByTk}`;
if (!field.forkCache.has(identityKey)) { /* create */ }
// 翻页时：清理不在当前页 identity 集合中的 fork
```

**方案 2b（彻底）**：在 FlowEngine 的 `createFork` 增加 `options.ttl` 或 LRU 上限（需改 `flowModel.tsx`，影响所有 fork 使用方——风险外溢，仅在 2a 不足时考虑）。

### 4.3 验收
- 连续翻页 20 次，聚合 `forkCache.size` 保持有界（≤ 2 × pageSize × 列数）
- 内存曲线不随翻页线性增长

---

## 5. Phase 3 — D2：单元格静态快路径（2–3 周，视基线决定）

### 5.1 原则
**不改 `TableColumnModel` 的渲染契约**，只在它内部开一个受严格门禁保护的快路径。凡是不满足门禁的单元格，完全走原 fork 路径。

### 5.2 门禁条件（全部满足才走快路径）
1. `!this.props.editable`（非编辑列）
2. 字段模型无 `beforeRender` flow / 无联动样式规则（对照 v1 的 `!_.isEmpty(styleRules)` 门控）
3. 非设计态（`!this.context.flowSettingsEnabled`）
4. 字段接口属于简单显示类型（文本/数字/日期/状态）
5. 无 ACL `hidden`/`forbidden`

### 5.3 快路径实现要点
- 直接 `get(record, fieldPath)` + 复用字段自身的格式化（从 `this.subModels.field.props` 取日期格式/标题字段等）
- **必须继续渲染 `DisplayTextFieldModel`**（即使不走 fork），否则 `plugin-text-copy` 的猴补丁（`textCopyDisplayField.tsx:39-77`）会失效——这是"运行时兼容但功能静默退化"的典型陷阱
- 参考 `JSColumnModel.tsx:139-205` 已有的 `MemoFlowModelRenderer` + 稳定组件工厂范式

### 5.4 验证顺序
先在共存块 `FastTableBlockModel` 里实现并验证，跑通全部 14 个 v2 表格单测 + Gantt + text-copy 专项后，再决定是否合入核心 `TableColumnModel`。

### 5.5 验收
- 首屏渲染耗时下降 40–60%（纯文本表）
- text-copy 复制按钮、联动样式、ACL 隐藏全部保持

---

## 6. Phase 4 — 定点虚拟（可选，+2–4 周）

仅在 Phase 1–3 后仍有 >500 行单表硬需求时启动。

### 6.1 三个必须先重写的组件
| 组件 | 现状 | 目标 |
|---|---|---|
| `body.wrapper`（`dragSortHooks.tsx:18-123`） | 非 forwardRef，渲染 `<tbody>` | `forwardRef` + 可滚动 div 容器 |
| `body.row`（`dragSortHooks.tsx:125-132`） | `(props)=><tr/>` 普通函数组件 | `forwardRef` + div 虚拟行 |
| `EditableCell`（`TableBlockModel.tsx:316-423`） | 渲染 `<td>`、每格新建 emotion css | 适配虚拟行 + CSS 提升模块级 |

### 6.2 其他必要条件
- 每列补数字 width（`:298-306`）
- `scroll.x` 从 `'max-content'` 改为数值（`:740-743`）
- `scroll.y` 数值化（`utils.ts:95-113` 当前仅两种 heightMode 给值）
- 虚拟只启用：`virtual && !dragSort && !treeTable && !anyEditable && allNumericWidths && numeric scroll`

### 6.3 不兼容项继续走非虚拟路径
树表、拖拽排序、行内编辑、展开行 —— 全部保持现状。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| memo 依赖漏项导致陈旧 UI（列配置/设计器原地改 schema） | 依赖取原始标量 + schema version；对照 `Table.tsx:185-186` 的设计器约束 |
| fork 清理误删正在使用的 fork | 用 identity guard + disposed 标记，不强制 dispose 活跃 fork |
| 静态快路径破坏 text-copy / 联动 / ACL | 严格门禁 + 专项回归测试 |
| 虚拟 DOM/ref 错误 | Phase 4 独立开关，默认 false，可单独回滚 |
| 上游升级冲突 | 改动集中在 3 个文件的少数函数，保持 diff 最小 |

**回滚粒度**：每个 Phase 独立提交，可单独 revert。Phase 1–2 无持久化 schema 变更，回滚零成本。

---

## 8. 测试策略

### 8.1 复用现有测试
- 14 个 v2 表格单测：`TableColumnModel.test.tsx:42-478`、`TableActionsColumnModel.test.tsx:98-384`、`rowSelection/dragSort/quickEditRefresh/blockHeight` 等
- 重点：`quickEditRefresh.test.ts:15-24` 断言 ACL 头——Phase 1–3 必须保持通过

### 8.2 新增测试
1. **渲染次数测试**：React Profiler 包裹，断言勾选/刷新时 `HighPerformanceTable` 提交次数下降
2. **fork 有界测试**：翻页 20 次，断言聚合 `forkCache.size` 有界
3. **快路径门禁测试**：编辑列 / 联动列 / ACL 隐藏列 / 配置态 必须走原 fork 路径
4. **text-copy 专项**：快路径下复制按钮仍存在
5. **契约快照测试**：`use` 字符串、flow step keys、`X-With-ACL-Meta` 头不变

### 8.3 执行
```bash
yarn tc packages/core/client-v2/src/flow/models/blocks/table
yarn eslint --fix <touched files>
```
（server 测试不可并行）

---

## 9. 验收指标（汇总）

| 指标 | 基线 | 目标（Phase 1–2） | 目标（Phase 3） |
|---|---|---|---|
| 勾选/刷新重渲染次数 | 实测 | ↓ ≥50% | ↓ ≥70% |
| 首屏渲染耗时 | 实测 | 持平或略降 | ↓ 40–60% |
| forkCache 大小（翻页 20 次） | 实测 | 有界 | 有界 |
| DOM cell 节点数 | 实测 | 持平 | 持平（Phase 4 才降） |
| 请求数 | 实测 | 不变 | 不变 |

---

## 10. 排期建议

| 阶段 | 工作量 | 依赖 |
|---|---|---|
| Phase 0 基线 | 2–3 天 | 无 |
| Phase 1 props 稳定 | 1 周 | Phase 0 |
| Phase 2 fork 治理 | 2–3 天 | Phase 1 |
| Phase 3 静态快路径 | 2–3 周 | Phase 1–2 基线决策 |
| Phase 4 定点虚拟 | +2–4 周 | Phase 3 后仍有硬需求 |

**最小可交付：Phase 0–2（约 2 周），零契约风险，覆盖主要交互卡顿。**

---

## 11. 一句话总结

只做三件事：**让 memo 真正生效（Phase 1）、让 fork 不再泄漏（Phase 2）、让简单单元格不再建 fork（Phase 3，按需）**。不换 antd、不重构区块、不碰任何持久化契约；虚拟滚动作为最后的可选放大器，而非起点。
