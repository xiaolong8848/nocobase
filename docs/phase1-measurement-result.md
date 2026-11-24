# Phase 1 性能改动实测结果（负面结果记录）

> 日期：2026-11-24
> 环境：dev 模式，pg16，200 行 × 10 列表，pageSize=200
> 测量方法：`checkbox.click()` 同步耗时（React 对 discrete event 同步刷新），12 次取中位数

## 实测数据

| 版本 | 12 次同步 click 耗时（ms，排序后） | 中位数 |
|---|---|---|
| **基线**（stash 回退 Phase 1 全部改动） | 462.5, 464.5, 467.1, 467.5, 471.1, **475.7**, 476.4, 481.5, 484.4, 485, 485.1, 505.7 | **476 ms** |
| **Phase 1 改动后**（props 稳定 + 行级 memo） | 460.9, 470.7, 475.5, 480, 481.9, **482.8**, 484.3, 487.5, 490.5, 492.3, 493.4, 564 | **484 ms** |

（dev server 完全重启后复测，排除热更新/缓存干扰，结果一致。）

**结论：Phase 1 改动对勾选交互耗时没有可测量的改善（差异在噪声内，甚至略慢）。**

## 为什么无效（根因分析）

1. **勾选卡顿的主因是 `HighPerformanceTable` 内部的 `selectedRowKeys` state**（`TableBlockModel.tsx:1022`）：
   ```ts
   const [selectedRowKeys, setSelectedRowKeys] = React.useState(selectedRowKeysFromResource || []);
   ```
   `onChange` 里 `setSelectedRowKeys(...)` 触发组件**自身**重渲染。`React.memo` 只阻止 props 变化引起的重渲染，**对组件内部 state 变化无效**。
   
   我稳定外部 props（pagination / selectedRowKeysFromResource）解决的是"外部 observer 重渲染击穿 memo"，与勾选路径无关。

2. **行级 memo 无效**：非拖拽行改为 `MemoBodyRow = React.memo(...)` 后无改善，说明 antd/rc-table 传给每行的 props（含 children cells 或 onRow 闭包）每次都是新对象，memo 命中不了。

3. **真正成本**：antd Table 收到新 `selectedRowKeys` 后做全表 reconcile（200 行 × 13 列，含 notes 长文本），约 470ms。

## 下一步需要更深的结构性改动（超出低风险范围）

要真正解决勾选卡顿，必须动 `HighPerformanceTable` 内部：

| 方案 | 做法 | 风险 |
|---|---|---|
| A. selectedRowKeys 去 state 化 | 用 `useRef` + 命令式更新 checkbox，避免 setState 触发整表重渲染 | 中（需与 antd rowSelection 契约兼容） |
| B. `shouldCellUpdate` | 给每列配 `shouldCellUpdate`，跳过未变化单元格 | 中（需逐列配置，动态列复杂） |
| C. 单元格池化 + 虚拟 | 定点虚拟（Phase 4）， mounted cell 从 2614 降到 ~200 | 中高（重写 3 个 body 组件） |

这些都不是"改引用稳定"能解决的，需要重构 `HighPerformanceTable` 内部或上虚拟滚动。

## 更新（同日续测）：找到真正的杠杆 — `shouldCellUpdate`

props 稳定化与行级 memo 确认无效后，尝试了第三个低风险改动：**给每列加 rc-table 原生的 `shouldCellUpdate`**（`TableColumnModel.tsx:331`）：

```ts
shouldCellUpdate: (record, prevRecord) => record !== prevRecord,
```

勾选时 record 引用不变 → 所有未变化 cell 跳过重渲染。

### 严格对比数据（同样 12 次同步 click，中位数）

| 版本 | 中位数 | DOM cell |
|---|---|---|
| 基线（stash 全部改动，dev 完全重启） | **488.9 ms** | 2614 |
| 仅 props 稳定 + 行级 memo | 484 ms | 2614 |
| **+ shouldCellUpdate** | **106.8 ms** | 2614 |

**下降约 78%，4.5 倍提升。** 功能验证：勾选切换 0→1→0 正常，2614 cell 数据完整，样例文本仍在。

### 根因确认

勾选卡顿主因是 antd Table 收到新 `selectedRowKeys` 后对**所有 cell** 做 reconcile（含 notes 长文本）。`shouldCellUpdate` 让 rc-table 对 `record` 未变化的 cell 直接跳过——这是.rc-table 为该场景设计的原生机制，改动仅一行列属性。

### 风险与待验证（重要）

`record !== prevRecord` 假设"数据更新时 record 引用必变"：
- ✅ `resource.refresh()` 后 API 返回新对象 → 引用变 → cell 更新（快速编辑刷新测试 `quickEditRefresh.test.ts:15-24` 需 e2e 确认）
- ⚠️ **联动样式（linkage）**：若样式由 observable 驱动、record 引用不变，cell 不会重渲染 → 可能失效。需跑 `linkageStyleSettings` e2e 验证
- ⚠️ **行内编辑**：编辑中的值变化若不换 record 引用，cell 可能不刷新。需 e2e 确认

### 结论修正

前报"低风险快赢无法解决、必须上虚拟"的判断**部分错误**：`shouldCellUpdate` 这一行改动就拿到 78% 收益，远超预期，且不需要虚拟滚动。props 稳定化/行级 memo 确实无效，但 `shouldCellUpdate` 是被漏掉的关键杠杆。

## 当前代码状态（已提交）

- `TableColumnModel.tsx`: `shouldCellUpdate`（核心收益）
- `TableBlockModel.tsx`: pagination 参数化 + useMemo + selectedKeySignature + TableBlockContent React.memo（无独立收益，但为虚拟化准备）
- `dragSortHooks.tsx`: MemoBodyRow（无独立收益）
- 单测 13 文件 / 55 用例全部通过，eslint 无警告

**下一步：跑 linkage / quick-edit e2e 验证 shouldCellUpdate 不破坏联动与编辑；若通过则保留，否则给 shouldCellUpdate 加门禁（非编辑/无联动列才启用）。**
