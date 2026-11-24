# v1 表格优化实施与测试结果

> 日期：2026-11-24
> 分支：perf/table-block-refactor

## 实施内容

v1 表格（`packages/core/client/src/schema-component/antd/table-v2/Table.tsx`）加入与 v2 同源的优化：

```ts
// Table.tsx columns useMemo（~326 行）
shouldCellUpdate: (record, prevRecord) => record !== prevRecord,
```

与 v2 的 `TableColumnModel.tsx` 完全相同的机制——antd/rc-table 原生列属性，勾选时 record 引用不变 → 跳过未变化 cell 的重渲染。

## 为什么这个改动是可靠的

1. **同源机制**：v2 用同样一行代码实测拿到 79% 收益（488ms → 100ms），v1 与 v2 都用 antd 5.24.2 的 Table/rc-table，机制一致
2. **零侵入**：只加一个列属性，不改 schema、不改 context、不改任何插件契约（31 个 v1 插件依赖的 `x-component: TableV2`、`table:configure*` 等全部不变）
3. **勾选安全**：v2 的教训表明要避免 props 稳定化/memo 行组件（会破坏勾选），v1 这次**只加 shouldCellUpdate 一行**，不碰其他

## 测试覆盖

| 测试 | 结果 |
|---|---|
| `table-performance.test.ts`（3 用例：record 不变跳过 / record 变化更新 / 首次渲染） | ✅ 3/3 |
| `table-v2-render.test.tsx`（集成：demo1 真实渲染，验证行/勾选框正常） | ✅ 1/1 |
| `table-v2.test.tsx`（既有：基础 + 树表） | ✅ 2/2 |
| eslint（改动文件） | ✅ 无新增 warning |

## 真实浏览器实测（已完成）

用户手动创建了 v1 页面 `/admin/w08sjcmyx6v`（绑定 perf_table，200 行 × 10 字段，2814 cells），在 dev 实例上做了严格对比（回退改动 + dev 完全重启排除缓存干扰）：

| 指标 | 基线（无 shouldCellUpdate） | 优化后 | 提升 |
|---|---|---|---|
| 勾选 12 次中位数 | **228.5 ms** | **146.3 ms** | **-36%** |
| 一次点击生效 | ✅ | ✅ | 无回归 |

测试过程：
1. 通过修改 block schema 的 pageSize（20 → 200）让表格加载 200 行
2. 回退 v1 的 shouldCellUpdate，重启 dev，测基线（228.5ms）
3. 恢复 shouldCellUpdate，重启 dev，测优化后（146.3ms）
4. 两种方式都验证一次点击即生效（checked + rowSelected 都正确）

## 对比总结

| | v1 | v2 |
|---|---|---|
| 改动 | Table.tsx +1 行 | TableColumnModel.tsx +1 行 |
| 浏览器实测 | ✅ 228.5ms → 146.3ms（-36%） | ✅ 488ms → 100ms（-79%） |
| 单测 | ✅ 4 用例 | ✅ 55 用例 |
| 渲染集成验证 | ✅ demo1 | ✅ 真实页面 |
| 功能安全 | ✅ 一次点击生效 | ✅ 勾选/编辑/联动实测 |

v1 收益（-36%）小于 v2（-79%），因为 v1 单元格由 Formily `NocoBaseRecursionField` 每格创建 `new Schema`，这部分固定开销 `shouldCellUpdate` 无法消除；v2 是 FlowEngine 的 fork 开销，跳过 cell 重渲染的收益更彻底。

两代页面**均已实测改善且功能无回归**。

## 提交记录

- `8138c938a6` perf(client): v1 TableV2 shouldCellUpdate + 逻辑单测
- `86ef3875d6` test(client): v1 渲染集成测试
