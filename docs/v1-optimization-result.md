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

## 诚实说明：v1 缺乏真实浏览器性能基线

v2 的性能基线是在真实浏览器 dev 实例上测的（`/v/admin/cpml0ns8jie`，200 行 × 10 列，勾选 488ms → 100ms）。

v1 **未能搭建同等的真实浏览器测试页**，原因：
- v1 页面依赖 Formily JSON Schema 的复杂父子存储结构，通过 API 手工构造的 schema 无法正确渲染（多次尝试 insert/insertAdjacent 均只存根节点，页面空白）
- v1 的界面配置入口在当前空页面上无 Grid 容器，无法手工添加区块

因此 v1 的收益**未做浏览器实测**，是基于"与 v2 同源机制 + 逻辑单测 + 渲染集成测试"的推断。预期与 v2 相当（交互减少 50–80%），但**精确数字需在真实 v1 页面上复测**。

## 对比总结

| | v1 | v2 |
|---|---|---|
| 改动 | Table.tsx +1 行 | TableColumnModel.tsx +1 行 |
| 浏览器实测 | ❌ 未做（schema 构造受阻） | ✅ 488ms → 100ms（-79%） |
| 单测 | ✅ 4 用例 | ✅ 55 用例 |
| 渲染集成验证 | ✅ demo1 | ✅ 真实页面 |
| 功能回归风险 | 低（只加列属性） | 已排除（勾选/编辑/联动实测） |

## 建议

若要在 v1 上拿到精确实测数字，建议用 v1 e2e 环境（`mockPage` + `templatesOfPage` 会自动创建完整表格页），写一个性能 e2e 测量勾选耗时。当前交付已达"逻辑正确 + 渲染正常 + 与 v2 同源"的可信度。

## 提交记录

- `8138c938a6` perf(client): v1 TableV2 shouldCellUpdate + 逻辑单测
- `86ef3875d6` test(client): v1 渲染集成测试
