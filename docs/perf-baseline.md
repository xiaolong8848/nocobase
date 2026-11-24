# 性能基线记录（v2.2.51）

> 采集日期：2026-11-24
> 环境：`/Users/xiaolong/nocobase-perf`，dev 模式，端口 13001
> 数据库：本地 pg16 容器（`nocobase_perf_test` 独立库）
> 页面：`/v/admin/cpml0ns8jie`（通过 `flowSurfaces:applyBlueprint` 创建）
> 表格：`perf_table`，202 条数据，10 字段（含 notes 长文本），pageSize=200

## 测试方法

- 集合 `perf_table` 通过 API 创建（10 字段）
- 202 条数据通过并发 `create` 插入
- 字段 interface 通过 SQL 补齐（select/number/datetime/textarea 等）
- 页面通过 `flowSurfaces:applyBlueprint` 生成（含 `TableBlockModel`，绑定 perf_table）
- 指标用浏览器 Performance API + MutationObserver 采集

## 基线数据

| 指标 | 数值 |
|---|---|
| DOM 节点总数 | **18,885** |
| 表格 cell 数（`.ant-table-cell`） | **2,614** |
| 表格行数（200 行全量挂载） | **200** |
| DOMContentLoaded | 1,191 ms |
| load | 1,191 ms |
| Long Tasks 数量 | 0（dev 模式未触发明显长任务） |
| 资源请求数 | 136 |
| **勾选一行交互耗时** | **1,330 ms** |
| 勾选引发的 DOM mutation 数 | 7 |
| 勾选后选中行数 | 1 |

## 关键观察

1. **200 行 × 10 列 = 2,614 个 cell 全量挂载**——无虚拟化，DOM 节点 18,885，与前面分析一致
2. **勾选一行耗时 1,330 ms**——这是 Phase 1 要优化的核心交互。虽然 MutationObserver 只捕获 7 次 DOM mutation，但耗时主要在 React 重渲染计算（200 行 × 列的 reconcile），而非 DOM 写入
3. notes 长文本字段（每条重复 3 次）放大了每格渲染成本

## 对照目标（Phase 1–3）

| 指标 | 基线 | Phase 1–2 目标 | Phase 3 目标 |
|---|---|---|---|
| 勾选交互耗时 | 1,330 ms | ↓≥50% (< 665 ms) | ↓≥70% (< 400 ms) |
| DOM cell 数 | 2,614 | 持平 | 持平（Phase 4 虚拟才降） |
| DOM 节点总数 | 18,885 | 持平 | 持平 |
| 首屏渲染 | ~1,191 ms | 持平/略降 | ↓40–60% |

## 复测命令

```bash
# 打开页面
http://127.0.0.1:13001/v/admin/cpml0ns8jie

# 浏览器控制台采集
performance.getEntriesByType('navigation')[0]
document.querySelectorAll('.ant-table-cell').length
```

勾选交互复测脚本见采集时的 MutationObserver 代码（本文件测试方法段）。
