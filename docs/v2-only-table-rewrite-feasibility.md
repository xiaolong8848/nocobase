# 仅 v2 表格区块重写：聚焦可行性结论

> 范围：`@nocobase/client-v2` + FlowEngine，**明确不做 v1 任何改动**
> 分支：`perf/table-block-refactor`　|　日期：2026-11-24

---

## 0. 结论先行

**在严格限定 v2、且保持「字符串契约 + 类身份 + 子模型拓扑」不变的前提下，重写表格区块在技术上可行，运行时对现有插件可做到接近 100% 兼容。**

但有三个必须正视的边界：

1. **服务端 flow-engine 的 275 处契约是字符串级的**——只要 `use:'TableBlockModel'`、flow step keys、subModel key `columns` 不变，它完全不受影响。这是最大的利好。
2. **plugin-gantt 覆盖了 `renderComponent()`**（`GanttBlockModel.tsx:697`）——原地重写主表格渲染不会破坏它，但它也拿不到性能收益，需要单独评估。
3. **「去 fork 快路径」会破坏 plugin-text-copy 的猴补丁**——`textCopyDisplayField.tsx:39-77` 给 `DisplayTextFieldModel.prototype.renderComponent` 打补丁；若静态格绕过 `FieldModelRenderer`/`DisplayTextFieldModel`，文本复制按钮会静默消失（不报错）。这是「运行时兼容但功能退化」的典型，最难被发现。

---

## 1. 范围收敛后的变化

| 维度 | 双运行时 | **仅 v2** |
|---|---|---|
| 需改代码库 | client + client-v2 | **仅 client-v2** |
| v1 的 31 插件 / 83 文件兼容性负担 | 有 | **完全消失** |
| `ResourceActionProvider` 全量 appends | 需修 | **不存在**（v2 已精确） |
| Formily 私有 `spliceArrayState` / 每表 FormContext | 需保留 | **不涉及** |
| 18 个 v1 e2e | 需回归 | **不涉及** |
| 服务端 flow-engine 275 处字符串契约 | 需协调 | 保持键名即可，**不受影响** |
| 工作量（A′+B） | 7–10 周 | **约 4–6 周** |

**范围收敛是显著的利好**：去掉了 v1 的所有历史包袱和一半的测试负担。

---

## 2. 原地重写 vs 共存新块（v2 内二选一）

### 路径 1：原地重写 `TableBlockModel` internals

**做法**：保持类名、`use` 字符串、flow keys、subModel 拓扑不变，只替换 `renderComponent()` / `getColumns()` / `components` / `HighPerformanceTable` 的内部实现。

**必须逐字保持不变的契约（否则协同修改）：**

| 契约 | 位置 | 依赖方 |
|---|---|---|
| `use: 'TableBlockModel'` | `TableBlockModel.tsx:952-968` | flow-engine 服务端 275 处；序列化树 |
| flow step keys（12 个） | `:770-950` | `catalog.ts:513-553` 精确 allowedPaths；Gantt 克隆 |
| `resourceSettings.init` / `resourceSettings2` | `:765-768` | 服务端 builder、sibling blocks |
| `subModels.columns` / `actions` | `:952-968` | `placement.ts:140`、`compiler.ts:1092` |
| `customModelClasses` 五键 | `:219-227` | Gantt、AddFieldColumn、renderConfigureActions |
| `createResource()` + `X-With-ACL-Meta` | `:270-274` | `with-acl-meta.ts:32-40`、quickEditRefresh 测试 |
| `TableColumnModel` 类身份 | `TableColumnModel.tsx` | file-manager `DisplayPreviewFieldModel.tsx:314,329`、map `DisplayMapFieldModel.tsx:108` 的 `instanceof` |
| `DisplayTextFieldModel` 渲染路径 | 字段绑定 | plugin-text-copy 猴补丁、formula/sequence/code 显示模型 |
| `rowClick` + `clickedRowRecord` | `:1191-1244` | 行点击变量、workflow action |

**对现有插件的实际影响：**

| 插件 | 影响 | 说明 |
|---|---|---|
| plugin-flow-engine（服务端） | ✅ 无影响 | 字符串契约不变 |
| plugin-gantt | ⚠️ 不受影响但也无收益 | 自身覆盖 `renderComponent()`，走 `<GanttBlock/>`；但覆盖了 `getActionsColumn`/`getPageSize` 等，重写时若改变这些方法语义会出问题 |
| plugin-file-manager / plugin-map | ✅ 无影响 | 只要 `TableColumnModel` 类身份和父子关系不变 |
| plugin-text-copy | ⚠️ **功能退化风险** | 去 fork 快路径若绕过 `DisplayTextFieldModel`，复制按钮消失 |
| export / bulk-edit / bulk-update / workflow-trigger | ✅ 无影响 | 依赖 `resource` API + `context.blockModel`，保持即可 |
| plugin-ai / block-tree / ui-templates | ✅ 无影响 | 鸭子类型基于基类契约 |

**收益**：所有表格自动获得性能提升（除 Gantt）；无新 block 类型、无菜单项、无 shim 回滚问题。

**风险**：改动落在 1244 行的核心文件，上游升级冲突概率高；Gantt 需要单独验证。

### 路径 2：共存新块 `FastTableBlockModel`

**收益**：核心文件零改动，回滚只是卸载插件。

**代价**：
- 服务端需追加 ~15 处注册才能获得功能对等（否则新块不能被设计器 authoring、不能承载 11 个表格专属 action、无 blueprint 导出、AI 不识别）
- 已证明 Gantt 虽是子类却未注册到 flow-engine → 子类化 ≠ 服务端支持
- 卸载插件后已写入 `use:'FastTableBlockModel'` 的页面需 shim

**判断**：在**仅 v2** 的前提下，路径 2 的主要优势（隔离核心文件、避免 v1 破坏）依然成立，但服务端注册的额外工作量使它的「快速验证」优势打折。

---

## 3. 推荐做法：混合策略

**阶段 A（1–1.5 周）— 低风险内部优化，原地做**
- 稳定 `pagination()` 返回对象、`selectedRowKeys` 派生（`TableBlockModel.tsx:685-700,706-763`）
- `TableBlockContent` 加 `React.memo`
- 每列补数字 width，替换 `scroll.x='max-content'`（`:298-306,740-743`）
- `JSColumnModel.tsx:139-205` 的 fork-by-pk + `MemoFlowModelRenderer` 范式可直接复用
- 不碰 `renderComponent` 的 88 行工具栏，不碰任何契约键

**阶段 B（2–3 周）— 去 fork 快路径，先在共存块验证**
- 插件内 `FastTableColumnModel.renderItem()` 静态/动态分流
- **静态格必须继续走 `DisplayTextFieldModel`/`FieldModelRenderer`**（或显式调用 text-copy 的复制逻辑），否则 plugin-text-copy 功能退化
- 门禁：非编辑、无 beforeRender 流、非配置模式、ACL 非 hidden/forbidden
- fork 加 dispose（解决无界增长）

**阶段 C（按需）— 虚拟滚动**
- 仅在新块内、仅平坦 + 非编辑 + 非拖拽 + 数字宽度的表启用
- 需重写 `body.wrapper`/`body.row`/`body.cell` 为 forwardRef + div 结构

**阶段 D（按需）— 决定是否把新块提升为默认**
- 若验证充分，可将优化合并回 `TableBlockModel`（获得 Gantt 之外的全部收益），并保留共存块作为回退

---

## 4. 最终回答

**Q：仅 v2 重写表格区块是否可行？**

**A：可行，且范围收敛后风险显著低于双运行时方案。**

- **技术上**：核心障碍是每格 fork/hook 开销和不稳定 props，这些都能在不触碰字符串契约的前提下优化
- **兼容性**：只要守住「use 字符串 + flow step keys + 类身份 + 子模型拓扑 + ACL 头」五条线，对现有插件可做到运行时 100% 兼容
- **已知例外**：① Gantt 不走主渲染路径，需单独特化；② text-copy 因猴补丁，去 fork 时必须保留 `DisplayTextFieldModel` 渲染路径，否则功能静默退化
- **不建议**：在 A/B 未量化前引入 TanStack（约 10–20% 的 DOM 层收益，不解决主导成本）

**关键提醒**：v2 的 appends 已经精确，v1 的全量 append 与 Formily 历史包袱都不在范围内——不要把双运行时分析里的 v1 工作项带进来。
