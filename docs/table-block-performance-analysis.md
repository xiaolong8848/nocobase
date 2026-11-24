# NocoBase v2.2.51 表格区块性能缺陷与重构可行性分析

> 分支：`perf/table-block-refactor`　|　基准版本：v2.2.51 (74cba858)　|　日期：2026-11-24
> 分析方式：源码逐行审查 + 依赖版本核对 + 社区 issue/PR 交叉验证

---

## 0. 执行摘要

**核心结论：性能瓶颈的主因不是 Ant Design，而是 NocoBase 自身的使用方式。**

antd Table 确实是「重」组件，但 NocoBase 的性能问题绝大多数来自：

1. **每单元格重建昂贵对象**：v1 每格创建 `new Schema()` + 合并 schema；v2 每格创建 `createFork()` + `createRecordMetaFactory()` + 6 个以上闭包。200 行 × 10 列 = 2000 次 fork。
2. **Memo 被不稳定 props 击穿**：`columns`、`pagination`、`selectedRowKeys` 每次渲染都是新对象引用，`React.memo(Table)` / `React.memo(HighPerformanceTable)` 形同虚设。
3. **虚拟滚动被主动关闭**：v2 已接好 antd `virtual` prop，但设置项被注释，且 `scroll.y` 默认 undefined，虚拟滚动无法生效。
4. **默认 append 所有关系字段**：v1 每个列表请求都把集合里所有带 `target` 的字段塞进 `appends[]`。
5. **N+1 短路被注释 + 只有「在途去重」没有缓存**：嵌套显示字段在 SubTable 中逐字段发请求。
6. **官方快路径是死代码**：`optimizeTextCellRender` 被设置为 true 但渲染函数从未读取。

**可行性结论：高。** 存在一条「低风险、可共存、可分阶段」的改造路径：以插件形式注册一个新的表格 BlockModel，保留既有 schema/ACL/数据流契约，只替换内部渲染引擎与单元格策略。完全重写（TanStack Table 路线）可行但风险与工作量显著更高。

---

## 1. 关键辨析：antd 的锅 vs NocoBase 的锅

针对「Ant Design 在表格渲染以及多关系数据加载时存在严重性能缺失」这一判断，需要客观拆分：

### 1.1 antd 确实存在的局限（但影响有限）

| 问题 | 证据 | 影响 |
|---|---|---|
| 非虚拟模式下全量挂载当前页所有行列 | antd Table 默认行为 | 单页 200 行 × N 列时 DOM 节点数巨大 |
| 虚拟表格在大数据 + 大 `scroll.y` 下卡死 | ant-design/ant-design#50343 | 需限定行高、列宽 |
| 无内置行级渲染隔离 | antd 设计如此 | 任一 props 变化触发整表 reconcile |

### 1.2 NocoBase 侧的问题（主因，且可自主修复）

| 问题 | 证据（file:line） |
|---|---|
| 每格创建 Formily Schema | `packages/core/client/src/formily/NocoBaseRecursionField.tsx:274-277,309-320` |
| 每格创建 fork + meta + 闭包 | `packages/core/client-v2/src/flow/models/blocks/table/TableColumnModel.tsx:336-385` |
| `FieldModelRenderer` 无 memo 且每渲染 `setProps` | `packages/core/flow-engine/src/components/FieldModelRenderer.tsx:30-89` |
| columns 数组无 memo，每次全量重建 | `packages/core/client/src/schema-component/antd/table-v2/Table.tsx:187-192` |
| `JSON.stringify` 当依赖、函数被丢弃 | `Table.tsx:470-473,1036,1086,1200` |
| 虚拟滚动设置项被注释 | `TableBlockModel.tsx:918-932`；渲染处 `:1172` |
| 死掉的快路径 | `useTableBlockProps.tsx:70` 设 `optimizeTextCellRender:true`，`Table.tsx:264-278` 从不读取 |
| 默认 append 所有关系 | `ResourceActionProvider.tsx:42-44` |
| 预加载短路被注释 | `useLazyLoadDisplayAssociationFieldsOfForm.ts:43-44` |
| 只有并发去重没有持久缓存 | `variables/utils/hasRequested.tsx:10-34`，resolve 后 `delete` |
| 窗口 resize 触发整表重渲染（宽度未被使用） | `useBlockSize.ts:179-204` + `Table.tsx:1192` |

### 1.3 多关系加载不是 antd 的职责

antd Table 只渲染传入的 `dataSource`。关系数据的获取完全由 NocoBase 决定：

- v1：`ResourceActionProvider` → `useRequest(ahooks)` → `appends[]` 参数
- v2：`MultiRecordResource.runAction()` → `CollectionFieldModel.addAppends()`
- 服务端：`OptionsParser.parseAppends()` → `EagerLoadingTree.load()` 批量查询

因此「多关系数据加载慢」的优化空间**完全在 NocoBase 层**，替换 antd 不会带来改善。

---

## 2. 架构约束：仓库里并存两套表格实现

这是所有改造计划的首要前提（`AGENTS.md:9-13` 规定单向依赖：v1 可引用 v2，反之不可）。

| | 旧版 v1（兼容入口） | 新版 v2（`/v/` 入口） |
|---|---|---|
| 运行时 | `@nocobase/client` | `@nocobase/client-v2` |
| 范式 | Formily JSON Schema | FlowEngine / FlowModel |
| 主表格 | `TableV2`（`table-v2/Table.tsx`，1269 行） | `TableBlockModel`（1244 行） |
| 渲染器 | `InternalNocoBaseTable` | `HighPerformanceTable` + `MemoizedTable` |
| 持久化 | `x-component: 'TableV2'` 等 x-* 键 | `use: 'TableBlockModel'` + `stepParams` |
| 引用规模 | 137 个 TS/TSX 文件引用 `TableV2` | 14 个单元测试 |
| 虚拟滚动 | **未接** | 已接但被注释禁用 |

**结论：两套实现几乎不共享代码，修一套不会修好另一套。** v2.2 起官方主推独立 `/v/` 入口，建议以 v2 为主要目标。

---

## 3. 性能缺陷清单（按优先级）

### P0 — 必须优先处理

**P0-1 每单元格对象风暴（v2）**
`TableColumnModel.tsx:336-385`：每格 `createFork` + `createRecordMetaFactory` + `defineProperty('record', {cache:false})` + `setProps`。200×10 = 2000 fork / 6000+ 闭包每次渲染。
叠加 `FieldModelRenderer.tsx:30-89`（无 memo + effect 内 `setProps`）形成逐格渲染放大环。

**P0-2 Memo 全量失效**
- v2：`TableBlockModel.tsx:685-700` 每渲染新建 `pagination()` 对象与 `selectedRowKeys` 数组 → `HighPerformanceTable` 的 `React.memo` 永远不 bail out；`TableBlockContent` 自身也无 memo。
- v1：`Table.tsx:187-192` `columnsSchemas` 无 `useMemo`（源码注释说明是为兼容设计器原地改 schema），导致下游 4 层 useMemo 全部重算，每列 `title`/`render`/`onCell`/`onHeaderCell` 全是新函数。

**P0-3 虚拟滚动未启用**
- v2：`TableBlockModel.tsx:918-932` 设置项被注释；`:1172` prop 已接；`utils.ts:99-102` 仅特定 heightMode 才给 `scrollY`。
- v1：完全没有 `virtual` prop，`scroll.x = 'max-content'`（`Table.tsx:1193-1198`）。

### P1 — 显著影响

**P1-1 默认 append 所有关系（v1）**
`ResourceActionProvider.tsx:43-44`：`collection.fields.filter(f => f.target).map(f => f.name)` 全部进 `appends[]`。与服务端 `EagerLoadingTree` 的「每关联节点每层级一次查询」相乘，12 个关系 = 每次翻页 ≥14 个 SQL，外加 `COUNT(DISTINCT ...)`。已有逃生开关 `disableDefaultAppends: true`。

**P1-2 嵌套显示字段 N+1**
`VariablesProvider.tsx:169-217` 按 URL 发请求；`hasRequested.tsx:10-34` resolve 后立即 `delete`，仅并发去重；`useLazyLoadDisplayAssociationFieldsOfForm.ts:43-44` 预加载判断被注释。作用于 Form/SubTable 单元格。

**P1-3 每格 linkage hook 无条件执行（SubTable）**
`association-field/Table.tsx:487-509` 每格调用 `useSatisfiedActionValues`，主表用 `!_.isEmpty(styleRules)` 做了门控（`:700-703`），SubTable 副本没有。

**P1-4 行选择触发整表重渲染**
v2 `:1000-1035`、v1 `:928-929,1096-1102`；v2 关闭拖拽时 `useDragSortRowComponent` 返回普通 `<tr>`（`dragSortHooks.tsx:125-132`），无行级隔离。

### P2 — 次要但值得修

- `optimizeTextCellRender` 死代码（`Table.tsx:264-278`）
- `JSON.stringify` 作为依赖导致 handler 陈旧（`Table.tsx:1086`）
- resize 触发无谓重渲染（`useBlockSize.ts:179-204`）
- `rowSelectionProps = observable.deep({})` 深追踪（`TableBlockModel.tsx:217`）
- `EditableCell` 每格新建 emotion css（`TableBlockModel.tsx:316-423`）
- drag-sort 开启时每次 tbody 渲染重算 flatDataSource（`dragSortHooks.tsx:57-112`）

---

## 4. 多关系数据加载分析

### 4.1 好消息：表格单元格本身没有 N+1

`NocoBaseField.tsx:16-21` 明确注释「为保持 Table 高性能，移除 Formily 相关组件」，单元格从预加载的嵌套对象直接取值。`ReadPretty.tsx` / `InternalTag.tsx` 也无 `api.request`。

### 4.2 真正的放大器

1. **全关系预加载**（P1-1）：服务端成本 = `1 COUNT + 1~2 根查询 + 每关联每层级 1 次 IN(pageIds) 查询`。
2. **变量按需请求**（P1-2）：SubTable 嵌套显示字段按记录发 `/{collection}/{id}/{assoc}:get|list`。
3. **无持久缓存**：无 DataLoader、无 react-query；ahooks `useRequest` 的 `uid` 只是结果注册表（`useRequest.ts:71-73`），不是缓存。
4. **重复请求**：页面重新激活（`DataBlockRequestProvider.tsx:138-145`）、列变化（`Table.tsx:162-165`）、参数变化都会全量重取。

### 4.3 优化方向

- 精确化 appends：只 append 实际显示的列；默认关闭全关系 append。
- 恢复变量预加载短路（`hasPreload` 已存在但调用被注释）。
- 引入按 URL + 参数的持久缓存（DataLoader 或简易 LRU），而非仅并发去重。
- 服务端考虑 `COUNT` 与 `find` 分离时对 to-many 避免 `COUNT(DISTINCT ...)`。

---

## 5. 重构可行性评估

### 5.1 可以替换

- 区块内部渲染引擎（v1 `InternalNocoBaseTable` 调用点 `:819-889`；v2 `HighPerformanceTable` `:970-1189`）
- 单元格渲染策略（`TableCellRender`、`optimizeTextCellRender` 快路径）
- 数据源（v2 `createResource()` 覆盖，官方示例已演示；v1 `requestService`）
- **新增可共存的表格区块类型**（v2 子类 + `registerModels`，官方 `plugin-custom-table-block` 已完整演示）

### 5.2 必须保留（契约）

- **持久化标识**：v1 `x-component: TableV2`、`x-use-component-props: useTableBlockProps`、`x-acl-action`、列子 schema；v2 `use: 'TableBlockModel'` + `stepParams` 键名 + `subModels.columns`
- **ACL**：`X-With-ACL-Meta` 请求头、字段白名单、逐字段 `ACLCollectionFieldProvider`
- **数据流**：分页/排序/筛选参数、跨区块联动 `x-filter-targets`、`useBlockRequestContext`（120+ 调用点）
- **交互**：行选择、拖拽排序、树展开、行点击 flow 变量
- **设计器集成**：initializer/settings 键名、14+ 语言文件
- **双许可证头**：AGPL-3.0 / 商业许可

### 5.3 主要风险

1. 双运行时重复实现
2. Formily 是承重结构（私有路径 `spliceArrayState`、每表 `FormContext`），绕过它会破坏子表、可编辑表格、联动与设计器
3. 影响面大：137 文件引用 `TableV2`，120+ 处 `useBlockRequestContext`
4. **仓库无现成虚拟化库**：`@tanstack/react-table ^8.21.3` 是未使用的死依赖，`react-window`/`react-virtualized` 均无
5. antd `virtual` 与自定义 `components.body.row`、拖拽包装、`EditableCell` 可能不兼容
6. v2 序列化模型名耦合，类名变更需迁移策略
7. v1 有 18 个 e2e + 4 个单测，v2 有 14 个单测；server 测试不可并行

---

## 6. 三条改造路径对比

| 路径 | 做法 | 收益 | 风险 | 工作量 |
|---|---|---|---|---|
| **A. 保守**（推荐起步） | v2 启用 antd `virtual`（取消 `:918-932` 注释、给 `scroll.y`、固定行高）；精确化 appends；修复死代码与 memo 失效 | 中~高（尤其中大表格） | 低 | 1~2 周 |
| **B. 中等**（推荐主线） | 插件内注册 `FastTableBlockModel extends TableBlockModel`，覆盖 `renderComponent()`，保留所有 provider/契约；自建行级 memo + 单元格池化 + 稳定 props | 高 | 中 | 4~8 周 |
| **C. 激进** | 引入 TanStack Table / react-virtual 重写渲染层 | 最高理论上限 | 高（破坏 Formily/设计器/ACL 契约） | 8~16 周+ |

---

## 7. 分阶段路线图

**阶段 0（本周）**：建立基线。选定 226 行 × 32 字段场景，用 React Profiler / Performance 面板记录首次渲染、滚动、勾选、翻页的耗时与 DOM 节点数。

**阶段 1（低风险快赢）**：
- 启用 v2 antd 虚拟滚动并验证兼容性
- `ResourceActionProvider` 默认 appends 改为按需（或默认 `disableDefaultAppends: true`）
- 修复 `optimizeTextCellRender` 死代码
- 稳定 `pagination()` / `selectedRowKeys` 引用（useMemo / 拆分选择器状态）

**阶段 2（共存新区块）**：
- 建立 `plugin-fast-table-block`，`FastTableBlockModel extends TableBlockModel`
- 覆盖 `renderComponent()`：行组件 memo、单元格渲染去 fork 化（仅在显示字段走轻量路径，编辑时再 fork）、稳定列对象
- 保留 `createResource()`、`X-With-ACL-Meta`、全部 flow 步骤键

**阶段 3（数据层）**：
- 变量预加载短路恢复 + 持久请求缓存
- 服务端 appends 收敛、COUNT 优化

**阶段 4（评估）**：仅当阶段 2 仍不达标，再评估路径 C。

---

## 8. 分支维护建议

当前已创建分支 `perf/table-block-refactor`（基于 detached tag v2.2.51）。建议：

```bash
cd /Users/xiaolong/nocobase-v2.2.51
# 若需长期维护，先建远端 fork 并推分支
git remote add fork git@github.com:<your-account>/nocobase.git
git push -u fork perf/table-block-refactor
```

改造以独立插件形式落在 `packages/plugins/@nocobase/plugin-fast-table-block/`，避免直接改 built-in 文件——这样可随上游版本升级而减少冲突。每次改动跑：

```bash
yarn tc packages/core/client-v2/src/flow/models/blocks/table
yarn eslint --fix <touched files>
```

---

## 9. 结论

- **antd 不是主要瓶颈**：表格渲染慢的根源是 NocoBase 的每格对象创建、memo 失效与未启用虚拟化；多关系加载慢与 antd 无关，是 appends 策略与缓存缺失。
- **重构可行且有清晰低风险路径**：先做「配置级 + 引用稳定」快赢，再以插件形式共存新表格区块，最后才考虑换渲染引擎。
- **不要绕过 Formily / FlowEngine 契约**：这是绝大多数激进重写失败的原因。
- **必须以数据说话**：每阶段都用同一基准场景量化，避免凭体感判断。

---

### 附：核心证据索引

| 主题 | 文件 |
|---|---|
| 每格 fork | `client-v2/.../table/TableColumnModel.tsx:336-385` |
| renderer 放大环 | `flow-engine/.../FieldModelRenderer.tsx:30-89` |
| v1 columns 无 memo | `client/.../table-v2/Table.tsx:187-192` |
| 虚拟滚动被注释 | `client-v2/.../TableBlockModel.tsx:918-932` |
| 默认 append 全关系 | `client/.../ResourceActionProvider.tsx:42-44` |
| 预加载短路被注释 | `client/.../useLazyLoadDisplayAssociationFieldsOfForm.ts:43-44` |
| 仅并发去重 | `client/.../variables/utils/hasRequested.tsx:10-34` |
| 服务端批量加载 | `database/.../eager-loading/eager-loading-tree.ts:228-497` |
| 官方共存扩展示例 | `plugins/@nocobase-example/plugin-custom-table-block/` |
