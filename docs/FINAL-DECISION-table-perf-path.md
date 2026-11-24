# 最终决策：v2 表格性能问题的优化路径

> 分支：`perf/table-block-refactor`　|　日期：2026-11-24
> 本文收敛前面 8 篇分析，给出单一明确建议

---

## 0. 结论

**不要先重构表格区块。按「配置层 → 原地手术 → 定点虚拟」三段式推进。**

核心洞察：**「重构表格区块」和「解决性能问题」不是一回事。**

- v2 表格的主导性能问题是三个**具体实现缺陷**，不是架构错误：
  1. `pagination()` / `selectedRowKeys` 每次渲染新建对象 → `React.memo` 失效（`TableBlockModel.tsx:685-700`，`HighPerformanceTable` 在 `:970-1189`）
  2. 每个单元格 `createFork` + `defineProperty` + 闭包 + `useApplyAutoFlows`（`TableColumnModel.tsx:336-385`）
  3. fork 缓存按行 key 存储且**无 dispose**，翻页无界增长（`flowModel.tsx:1384-1412`）

- 前两项**可以原地修复**，不需要重构。
- 「重构」的主要成本其实花在**让 antd 虚拟滚动能用**——重写三个非 `forwardRef` 的 body 组件（`dragSortHooks.tsx:18-123,125-132`）、补数字列宽、处理树表/编辑/拖拽兼容。虚拟滚动只是**减少挂载数量**，并不消除上述单格成本。

**所以：重构是被虚拟滚动绑架的，不是性能本身的需要。先修能原地修的，再按实测量决定是否值得为虚拟滚动付出重构代价。**

---

## 1. 决策树（按你的数据规模对号入座）

| 场景 | 推荐路径 | 工作量 | 预期收益 |
|---|---|---|---|
| **< 100 行 且 < 15 列** | 仅配置层（§2）+ 原地 props 稳定（§3.1） | 1–2 周 | 交互卡顿基本消除 |
| **100–500 行 或 15–30 列** | §3 原地手术全套 + fork 去化（在共存块验证） | 3–5 周 | 首屏 40–60%，交互 60–80% |
| **> 500 行 或 > 30 列，且必须单表展示** | 上述 + 定点虚拟（§4） | 6–9 周 | 挂载 cell 减少 85%+ |
| **超大数据 / 复杂分析** | 不要虚拟滚动——改交互形态（§2 配置层：分页/主子表/汇总） | 低 | 从源头规避 |

**默认推荐：先做 §3 原地手术（1.5–2.5 周），用实测数据决定是否进入 §4。**

---

## 2. 零代码改动的路径（先试，可能就够了）

在动代码之前，这些配置/使用方式能立即改善：

| 手段 | 效果 |
|---|---|
| 减小 pageSize（20 → 50 上限评估） | 直接减少挂载行数 |
| 减少列数：把低频字段移到详情弹窗 | 每列成本 × 行数是乘积关系 |
| 关闭非必要的联动样式规则 | 每格 linkage hook 开销 |
| 关闭行选择 / 拖拽（若非必需） | 减少全表重渲染触发源 |
| 大字段（附件/富文本/关联标签）不放进表格列 | 这些字段渲染最重 |
| 拆主子表或用汇总报表替代超宽表 | 从源头规避 |

**如果这些就能把体验拉到可接受，就不要动代码。**

---

## 3. 原地手术（推荐主线，改核心但零契约风险）

### 3.1 稳定 props（P0，必做）
- `pagination()` 返回值、selectedRowKeys 派生改为按原始值 memo（`TableBlockModel.tsx:572-614,685-700`）
- `TableBlockContent` 加 `React.memo`（`:706-763`）
- 每列补数字 width，把 `scroll.x='max-content'` 改为数值（`:298-306,740-743`）

### 3.2 修复 fork 生命周期
- `createFork` 的 key 加 dispose / 翻页时清理（`flowModel.tsx:1384-1412`）
- 参考 `JSColumnModel.tsx:139-205` 已有的 fork-by-pk + `MemoFlowModelRenderer` 范式

### 3.3 为什么这些都安全
不改 `use:'TableBlockModel'`、不改 flow step keys、不改 `subModels.columns`、不改 `X-With-ACL-Meta`、不改 `TableColumnModel` 类身份——服务端 275 处字符串契约、Gantt 子类、file-manager/map 的 instanceof 检查全部不受影响。

---

## 4. 定点虚拟（仅当 §3 后仍不达标）

**唯一硬阻碍**：三个 body 组件不是 `forwardRef` 且渲染 `<tbody>/<tr>/<td>`，与 rc-virtual-list 的 ref 测量和 div 虚拟行不兼容。

要做的是**定点重写这三个组件**，而不是重写整个表格区块：
- `body.wrapper` / `body.row` 改为 `forwardRef` + div 结构
- `EditableCell` 适配虚拟行
- 仅对「平坦 + 非编辑 + 非拖拽 + 数字宽度」的表启用；树表/拖拽表继续走非虚拟路径

建议在**共存块**（`FastTableBlockModel`）里做，验证充分后再决定是否合并回核心。

---

## 5. 明确不推荐

| 路径 | 原因 |
|---|---|
| **完整重构表格区块 / 换 TanStack** | 12–20+ 周；只解决 10–20% 的 DOM 层开销，主导成本没碰到；契约风险最高 |
| **为性能删除 v1** | v1 与 v2 运行时性能无关，只影响构建体积 |
| **把 v2 低代码和 AI Portal 合并路由** | 两套前端技术栈/构建/路由全不同，得不偿失 |

---

## 6. 一句话行动建议

**先做 1–2 周的配置层治理 + 原地 props 稳定，拿出基线数据；若仍有 >500 行单表的硬需求，再做定点虚拟改造。整表重构放到最后，且大概率不需要。**

---

### 关联文档
- `table-block-performance-analysis.md` — 缺陷清单与 A/B/C 初评
- `table-refactor-options-and-compatibility.md` — 虚拟滚动阻断分析 + 插件兼容性
- `v2-only-table-rewrite-feasibility.md` — v2-only 重写边界
- `v1-stripping-feasibility.md` — v1 剥离（与性能无关）
