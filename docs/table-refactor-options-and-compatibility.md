# 表格区块重构：A/B/C 方案详评与插件兼容性审计（续报）

> 分支：`perf/table-block-refactor`　|　日期：2026-11-24
> 本文是 `table-block-performance-analysis.md` 的续报，包含对前报结论的**两处重要修正**。

---

## 0. 对前报的两处关键修正

### 修正 1：antd 虚拟滚动不是「配置快赢」，而是被硬性阻断 ❗

前报建议「取消 `TableBlockModel.tsx:918-932` 的注释即可启用虚拟滚动」——**这是错误的**。

源码级验证（antd 5.24.2 / rc-table 7.50.3 / rc-virtual-list 3.18.3）：

1. **设置项本身失效**：被注释的 `virtualScrolling` 用的是 `uiSchema`，而当前所有活跃步骤都用 `uiMode`（对比 `TableBlockModel.tsx:918-932` 与 `:775-782`）。
2. **`scroll.x` 类型不兼容**：当前为 `{ x: 'max-content', y }`（`TableBlockModel.tsx:740-743`）；rc-table 虚拟模式会强制 `scrollX = 1`，导致每行宽度 1px；`columns` 中的 `empty` 列没有 width（`:298-300`），会产生 `NaN` 偏移。
3. **`scroll.y` 通常为 undefined**：`utils.ts:95-113` 只在 `heightMode === 'specifyValue' | 'fullHeight'` 时给出数值。
4. **三个自定义 body 组件全部不兼容**：
   - `body.wrapper`（`dragSortHooks.tsx:18-123`）非 `forwardRef`，且渲染 `<tbody>`，而 rc-virtual-list 需要可滚动 DOM 节点的 ref，并插入 div 虚拟行 → `componentRef.current` 为 null 会抛错，DOM 嵌套非法。
   - `body.row`（`dragSortHooks.tsx:125-132`）是普通函数组件 `(props) => <tr {...props}/>`，无法接收 rc-virtual-list 的 ref → 行高测量失败，滚动跳动。
   - `body.cell`（`EditableCell`，`TableBlockModel.tsx:316-423`）渲染 `<td>`，在 div 虚拟行中布局错误。
5. **v1 更彻底**：根本没有 `virtual` prop（`Table.tsx:863-878`），还需额外解决 Formily 每格组件兼容。

**结论：启用虚拟滚动需要先重写 wrapper/row/cell 三个虚拟安全组件（forwardRef + div DOM + 数字宽度），这已属于方案 B 的范畴，不再是配置改动。**

### 修正 2：「每格 2000 个新 fork」表述不准确

`createFork()` 按 key 缓存（`flowModel.tsx:1384-1412`），实际是「缓存查找 + setProps + defineProperty + 新闭包 + 每格一个 useApplyAutoFlows/useRequest」。但**真正的问题更隐蔽**：fork key 基于行标识 `${record.__index||index}_${rowKey}`（`TableColumnModel.tsx:341`）且永不 dispose → 翻页/滚动时 `forkCache` 无界增长。

### 修正 3：v2 的 appends 已经是精确的

「默认 append 所有关系」只存在于 v1（`ResourceActionProvider.tsx:42-45,81-94`）。v2 通过 `CollectionFieldModel.tsx:153-156` → `CollectionBlockModel.tsx:590-648` 按显示字段精确添加。因此 appends 优化是 **v1 专属工作**。

---

## 1. A/B/C 方案详细评估

### 方案 A′：保守原地修复（不含虚拟滚动）

**范围**：v1 数据层（精确 appends、预加载短路、死 flag）+ v1/v2 memo 稳定化 + 数字宽度准备。

| 项 | 内容 |
|---|---|
| 修改文件 | ~10 个核心文件，无新文件 |
| v1 关键文件 | `ResourceActionProvider.tsx:42-55,81-94`；`hooks/index.ts:2028-2063`；`Table.tsx:173-400,464-545,1086,1193-1198`；`useTableBlockProps.tsx:69-70`；`useLazyLoadDisplayAssociationFieldsOfForm.ts:43-44,99-103`；`hasRequested.tsx:10-34` |
| v2 关键文件 | `TableBlockModel.tsx:572-614,616-763,970-1189`；`utils.ts:95-131` |
| 收益 | v1 appends：服务端延迟降 40–70%；memo：勾选/高亮/resize 交互减少 50–80% 客户端工作；死 flag：纯文本表首屏快 20–40% |
| 不解决 | 每格 fork、挂载 cell 数量（首屏DOM） |
| 风险 | ① `optimizeTextCellRender` 若实现为「总是纯文本」会绕过 ACL 白名单与联动样式（`Table.tsx:188,687-709`）；② `columnsSchemas` 不能简单 useMemo——源码注释明确设计器原地改 schema（`Table.tsx:185-186`），需按 schema version/uid 稳定化；③ 移除 v1 默认 appends 后，因预加载短路仍关闭，显示字段可能变空或触发 N+1，必须同时修 `:43-44`；④ 持久 URL 缓存无失效会导致关系数据陈旧 |
| 回滚 | 纯代码改动，revert 即可；无 schema 迁移 |
| 工作量 | **1.5–2.5 工程师周**（前报低估） |
| 兼容性 | v1/v2 均高：schema key、导出组件、组件身份、context 全部不变 |

**A-full（含虚拟）**：需额外重写 3 个虚拟安全组件 + 数字宽度 + 树/编辑/拖拽矩阵 + 新测试，**总计 3.5–7 工程师周**，且 v1 还要再做一遍（+2–4 周）。

### 方案 B：共存的高性能表格区块（主线推荐）

**形式**：插件 `plugin-fast-table-block`，注册 `FastTableBlockModel extends TableBlockModel`。

**最小覆盖集合**（TableBlockContent / HighPerformanceTable 是模块级常量，必须通过 `renderComponent()` 切入）：

| 成员 | 基类位置 | 处理 |
|---|---|---|
| `renderComponent()` | `TableBlockModel.tsx:616-703` | **必须覆盖**（88 行工具栏需复制或提取） |
| `getColumns()` | `:293-310` | **必须覆盖**（注入稳定 render / shouldCellUpdate / 数字宽度） |
| `components` 字段 | `:425-433` | **覆盖**（虚拟安全 row/cell，emotion CSS 提升到模块级） |
| `renderCell` / `pagination()` / `createResource()` / flows / rowClick 事件 | 多处 | **全部复用继承**——这是保住契约的关键 |
| `customModelClasses` | `:219-227` | **显式保留**五个默认映射（至少 `TableColumnModel → FastTableColumnModel`），否则 AddFieldColumn 会创建不兼容子模型 |

**避免每格 fork 的安全做法**：在 `FastTableColumnModel extends TableColumnModel` 覆盖 `renderItem()`（`TableColumnModel.tsx:336-385`），做静态/动态分流：

- 静态显示单元格（非编辑、无 beforeRender 流、非配置模式、无 ACL hidden/forbidden）→ 直接 `get(record, fieldPath)` + 复用字段格式化，用普通 React（或 MemoFlowModelRenderer）渲染
- 动态单元格（可编辑、联动规则、关联显示、配置模式）→ 保留原 fork 路径原样

分流门禁必须包含：`!this.props.editable`、无 `beforeRender` 流、`!flowSettingsEnabled`、ACL `hidden/forbidden`/`canQuickEdit()`。`createResource()` 保留不动（带 `X-With-ACL-Meta`，被 `with-acl-meta.ts:32-40` 和测试 `quickEditRefresh.test.ts:15-24` 依赖）。

**仓库内已有范式可复用**：`JSColumnModel.tsx:139-205` 已实现 fork-by-pk + signature 失效 + `MemoFlowModelRenderer` + 稳定组件工厂，照此形状实现即可，不要发明新抽象（AGENTS.md）。

**注册与菜单发现**：
- `registerModels({FastTableBlockModel, FastTableColumnModel, ...})`（示例插件 `plugin.tsx:13-17`）
- `static get meta()` **不继承**（`flowModel.tsx:387-389`）→ 必须自行 `FastTableBlockModel.define({...})`，复制基类定义（`:952-968`）并改 `use: 'FastTableBlockModel'`；否则新块没有 columns，只渲染 Skeleton（`:620-622`）

**收益**：行级 memo + 稳定列对象 → 交互渲染减少 60–80%；静态去 fork → 首屏快 40–60%；叠加 A′ 的数据层收益；虚拟可后续在新块内单独启用。

**工作量**：**5–8 工程师周**（脚手架 1 周 + 去 fork 门禁 2–3 周 + memo/虚拟/测试 2–4 周）。

### 方案 C：TanStack Table / react-virtual 全量重写

| 项 | 内容 |
|---|---|
| 现状 | `@tanstack/react-table ^8.21.3` 是 `core/client/package.json:36` 的**死依赖**（无任何 import）；无 `@tanstack/react-virtual`、无 `react-window`/`react-virtualized` |
| 必须重建 | headless 引擎不提供 DOM/虚拟/ACL/Formily：列定义、分页、排序、选择、树展开、固定列、拖拽、行内编辑、行点击变量、设计器集成、ACL |
| 收益 | 仅替换 antd DOM/reconcile 层约 **10–20%**；主导成本（fork、props、appends、N+1）完全不受影响——除非同时做 A′+B，那同样可达且风险低得多 |
| 风险 | v1 137 文件引用 + 18 e2e；v2 275 处服务端字符串契约；ACL `X-With-ACL-Meta` 丢失；Formily 私有 `spliceArrayState` 无法复现 |
| 工作量 | **12–20+ 工程师周**（仅 v2）；含 v1 对齐 20–30+ 周 |
| 结论 | **不建议**，投入产出比最差 |

### 对比矩阵

| 维度 | A′ | A-full | B | C |
|---|---|---|---|---|
| 解决每格 fork | ❌ | ❌ | ✅（静态格） | ❌（除非也做 B） |
| 解决不稳定 props | ✅ | ✅ | ✅ | ✅ |
| 解决 appends/N+1 | ✅ | ✅ | ✅（叠加 A′） | ❌ |
| 挂载 cell 减少 | 无 | ~85–92%* | 60–80% 渲染减少 | 理论相近 |
| antd virtual 兼容 | n/a | **当前阻断** | 需虚拟安全组件 | n/a |
| v1 生态兼容 | 高 | 低 | 高（不动 v1） | 低 |
| v2 生态兼容 | 高 | 中 | 高（继承契约） | 中低 |
| 工作量 | 1.5–2.5 周 | 3.5–7 周 | 5–8 周 | 12–20+ 周 |

\* 仅在 3 个虚拟安全组件重写后才可达。

---

## 2. 插件兼容性审计

### 2.1 v1 侧（31 个插件 / 83 文件有表格契约依赖）

| 风险 | 插件 | 原因 |
|---|---|---|
| **HIGH（8）** | gantt、departments、client、action-bulk-edit、action-bulk-update、action-export、block-template、audit-logs | 消费/改写私有 table context（`expandFlag`、`field.onExpandClick`、`field.onRowSelect`、`field.data.selectedRowKeys`）、自行构造 `TableBlockContext.Provider`、提供被其他插件引用的 `useTableBlockProps`、或把整套 schema 语法编码进业务逻辑 |
| **MEDIUM（17）** | action-import、action-duplicate、workflow-custom-action-trigger、file-manager、action-custom-request、mobile、charts、map、users、api-keys、public-forms、user-data-sync、verification、notification-manager、acl、data-source-manager、workflow-manual | 主要是 initializer/settings 键名消费者与静态 TableV2 schema 定义者。渲染器内部替换（保留导出/context）可存活；schema key 一改全坏 |
| **LOW（6 + 全部示例）** | kanban、calendar、comments、action-print、data-visualization、flow-engine | 运行时无 v1 表格契约；仅 35 个测试/e2e 文件硬编码 TableV2 aria-label |

关键证据：
- `plugin-gantt/src/client/components/gantt/gantt.tsx:164-165`：`tableCtx.field.onExpandClick = ...; tableCtx.field.onRowSelect = ...`
- `plugin-action-export/src/client/index.ts:40`：`tableActionInitializers?.add(...)` → key 改名后**功能静默消失**
- `plugin-mobile/src/client/mobile/styles.ts:48`：CSS 硬编码 `.ant-table-thead button[aria-label*="schema-initializer-TableV2-table:configureColumns"]`

### 2.2 v2 侧（运行时 + 服务端）

| 风险 | 组件 | 原因 |
|---|---|---|
| **CRITICAL** | `plugin-flow-engine/src/server/flow-surfaces/*` | **275 处**硬编码 `TableBlockModel`/`TableColumnModel` 字符串：精确 step-path 白名单（`catalog.ts:513-553,997-1010`）、11 个表格专属 action 的容器门禁（`:3556-3682`）、树表逻辑、blueprint 导出/导入、~40 个契约测试 |
| **CRITICAL** | `plugin-gantt`（v2） | `GanttBlockModel extends TableBlockModel`（`client-v2/models/GanttBlockModel.tsx:78`），覆盖 20+ 方法，从基类 `globalFlowRegistry` 克隆 `tableSettings` steps（`settings.tsx:39-130`），使用 `instanceof TableActionsColumnModel` |
| **HIGH** | plugin-file-manager、plugin-map、plugin-text-copy | `instanceof TableColumnModel` 分支（`DisplayPreviewFieldModel.tsx:314,329`；`DisplayMapFieldModel.tsx:108`）；`DisplayTextFieldModel.prototype.renderComponent` 猴补丁（`textCopyDisplayField.tsx:39-77`）——单元格不再用这些模型时功能静默丢失 |
| **MEDIUM** | export、bulk-update、bulk-edit、workflow-custom-action-trigger、duplicate、print | 依赖 `ctx.blockModel.resource.getSelectedRows/setSelectedRows/getFilter`、`collection.getFilterByTK`、constructor.name 检查 |
| **LOW** | ai、block-tree、ui-templates、comments、calendar、kanban、list、grid-card | 鸭子类型 / 基类级契约（`CollectionBlockModel`、`MultiRecordResource`、`addAppends`） |

**Gantt 是决定性证据**：它 `extends TableBlockModel` 却在 `plugin-flow-engine/src` 中出现 **0 次**——证明「子类化不会自动继承服务端 authoring 支持」。

### 2.3 核心问题回答：重写后的高性能表格区块对已有插件是否完全兼容？

**分三种情况，答案不同：**

| 做法 | 运行时兼容 | 功能对等 | 说明 |
|---|---|---|---|
| **原地重写 `TableBlockModel` internals** | ❌ 不完全 | ✅ 自动 | Gantt + flow-engine 服务端 275 处契约 + instanceof 检查需协同修改 |
| **共存新区块（`use: 'FastTableBlockModel'`）** | ✅ **100%** | ❌ 不自动 | 现有已序列化树、settings、测试字节级不变；但新块不会自动获得 11 个表格专属 action、flow surfaces authoring、树表语义、blueprint 导出、AI block 识别 |
| **共存但保留 `use: 'TableBlockModel'` + 行为标志** | ✅ | ✅ | 可同时获得兼容与对等，但本质不是「新 block 类型」 |

**共存新块必须实现的最小契约（运行时 100% 兼容的硬要求）：**
1. 继承 `CollectionBlockModel`/`TableBlockModel`，从而继承 `context.blockModel`、`collection`、`resource`、`addAppends`、`createResource`
2. `resource` 必须是真实 `MultiRecordResource`，暴露 `getSelectedRows`/`setSelectedRows`/`getFilter`/`setPage`/`setSort`/`refresh`/`runAction`/`supportsFilter` 等（export/bulk/workflow-trigger/tree-connect/AI 依赖）
3. `collection` 暴露 `filterTargetKey`、`getFilterByTK()`、`getFields()`、`fields`、`title`
4. 子模型拓扑：`subModels.columns`（`TableColumnModel` 实例，含 `subModels.field`）+ `subModels.actions` + `TableActionsColumnModel` + `customModelClasses` 五键保留
5. Flow 键逐字一致：`resourceSettings.init`、`resourceSettings2`、`tableSettings` 下 12 个步骤；`rowClick` 事件 + `clickedRowRecord` 上下文属性
6. 保持 `DisplayTextFieldModel` 绑定（text-copy 猴补丁、formula/sequence/code 显示模型依赖）

**若要功能对等**，还需在 `plugin-flow-engine` 服务端注册表中追加新 `use`：至少 15 处（`catalog.ts`、`action-scope.ts`、`node-use-sets.ts`、`field-semantics.ts`、`placement.ts`、`authoring-validation.ts`、`builder.ts`、`surface-context.ts`、`template-compatibility.ts`、`configure-options.ts`、`service-utils.ts`、`reaction/registry.ts`、`runjs-authoring/constants.ts`、`support-matrix.ts`、`service.ts`）。这些是**追加式、非破坏性**的，但要逐项测试。

**回滚注意**：一旦页面写入 `use:'FastTableBlockModel'`，卸载插件会留下不可解析模型（fallback `ErrorFlowModel`）。需保留 shim 插件将 `FastTableBlockModel` 映射回 `TableBlockModel`，或做 schema `use` 迁移。

---

## 3. 最终建议路线

1. **阶段 0 基线**：226 行 × 32 字段，记录首屏/滚动/勾选/翻页耗时 + DOM 节点数 + fork 数 + 请求数
2. **阶段 1 A′**：v1 精确 appends + 预加载短路 + 死 flag 语义；v2 稳定 `pagination()`/selectedRowKeys、数字列宽。**不启用虚拟**
3. **阶段 2 B**：`plugin-fast-table-block`，最小覆盖 `renderComponent`/`getColumns`/`components`；`FastTableColumnModel` 做静态/动态分流；完备 `define()` 与 `customModelClasses`；继承 `createResource`/flows/events —— 满足上述 6 项硬契约，达到运行时 100% 兼容
4. **阶段 2.5 功能对等**：按需要向 `plugin-flow-engine` 注册表追加新 `use`（15 处），使新块可被设计器 authoring、承载 11 个表格 action、支持 blueprint 导出
5. **阶段 3 虚拟**：仅在新块内、对「平坦 + 非编辑 + 非拖拽 + 数字宽度」的表启用；树表/编辑/拖拽继续走非虚拟路径
6. **阶段 4**：仅当 A′+B 实测仍有差距，才评估 C

**一句话结论**：兼容性最好的不是「重写」，而是「共存 + 继承契约」；虚拟滚动是当前最大的认知陷阱，必须先重写三个 body 组件才可能安全启用。
