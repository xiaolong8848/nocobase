# Phase 2 结果：V2 表格 fork 缓存上限修复

> 日期：2026-11-24
> 分支：perf/table-block-refactor

## 背景

扩展到 5000 条数据（25 页 × 200 条/页）后，发现翻页时 fork 缓存持续增长，页面逐渐卡死。

## 根因

`TableColumnModel.renderItem`（`:343`）用 `${record.__index || index}_${rowKey}` 作为 fork key 创建单元格 fork。翻页产生新 rowKey → 新 fork。而 `ForkFlowModel` 的 `onUnmount` 被注释（`forkFlowModel.ts:242-256`，注释说明"避免破坏外部 fork 管理"），React 卸载 cell 时不会 dispose fork → 缓存随浏览页数线性增长。

**实测证据**（5000 条数据，dev 模式）：
| 操作 | forkCache 大小（单列） |
|---|---|
| 初始（第1页） | 200 |
| 翻到第2页 | 400 |
| 翻回第1页 | 400（未回收） |
| 继续翻多页 | 1200+（页面卡死，evaluate 超时） |

## 修复

在 `TableColumnModel.renderItem` 创建 fork 前加缓存上限（插入顺序 Set，释放最早 fork）：

```ts
const MAX_CELL_FORKS = 600;
if (field.forks.size > MAX_CELL_FORKS) {
  const oldest = field.forks.values().next().value as { dispose: () => void } | undefined;
  oldest?.dispose();
}
const fork = field.createFork({}, `${record?.__index || index}_${rowKey}`);
```

`dispose()` 会同时从 `master.forks` 和 `forkCache` 移除自己（`forkFlowModel.ts:258-306`），因此缓存有界。

## 验证

| 项 | 结果 |
|---|---|
| 修复后翻多页 forkCache | 稳定在 **601**（上限 600 + 当前页），不再增长 ✅ |
| 修复后单次翻页 refresh | ~729ms（API + 渲染） ✅ |
| 表格单测 | 13 文件 / 55 用例全过 ✅ |
| eslint | 无新增 warning ✅ |

对比：修复前缓存增长到 1200+ 且页面卡死（evaluate 60 秒超时）；修复后稳定 601、翻页正常。

## 边界说明

- 上限 600 = 3 页 × 200 行，覆盖"当前页 + 前后各一页"的常见浏览模式；再次访问更早页面会重建 fork（正确行为，代价是小幅重渲染）
- 未改 FlowEngine 全局 `createFork`（避免影响其他 fork 用户）
- 未启用 `ForkFlowModel.onUnmount`（风险高，官方注释明确避免破坏外部管理）
- 局部改动，仅在 v2 表格单元格路径

## 结论

Phase 2 fork 缓存上限修复有效：消除了 5000 条数据多页浏览时的内存泄漏与页面卡死，改动仅 6 行、零契约变更。

## 提交

- `perf(client-v2): cap cell fork cache to prevent unbounded growth on pagination`
