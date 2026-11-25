# V2 表格性能优化实施记录

> 日期：2026-11-25
> 分支：`perf/table-block-refactor`（v2.2.51 fork）
> 对应评估：`docs/v2-table-next-optimization-evaluation.md`

## 已实施

### 1. 配置层 pageSize（最高收益，零代码）
测试页 `/v/admin/cpml0ns8jie` 的表格 block（uid `ayxavaksteg`）pageSize **200 → 50**，
通过 `flowModels:save` 持久化。
若需恢复：把该模型 `stepParams.tableSettings.pageSize.pageSize` 改回 `200`。

### 2. 修复配置保存后 hover 预取失效
- `prefetchFlowPage.ts` 导出 `clearPrefetchPageUids()`。
- `FlowModelRepository.clearPrefetchCache()`（save / destroy / move / duplicate 共用）调用它。
- 之前 repository 只清 `prefetchedFindOne`，模块级 `prefetchedPageUids` 未清，导致配置保存后同一页面
  hover 预取永久跳过，首次切换退化到未预取路径。
- 单测：`prefetchFlowPage.test.ts` 3 passed。

### 3. query 白名单化的 beforeRender 判定
- 新增 `utils/nonDataQuerySignature.ts`：剔除 `_t` / `_r` / `timestamp` / `__ts`，按键排序。
- `CollectionBlockModel.onMount/onActive` 用规范化签名替代原始 `location.search`。
- `onActive` 现在同步更新 `previousBeforeRenderHash`，避免同一 query 反复触发 rerender。
- 单测：`nonDataQuerySignature.test.ts` 3 passed。

### 4. 服务端 simplePaginate 决策缓存
- `default-actions/list.ts` 用 `WeakMap<collection, {at,value}>` 缓存 `getEstimatedRowCount()` 决策，TTL 10 分钟。
- 4998 行的 `perf_table` 远低于 `SIMPLE_PAGINATION_LIMIT=300000`，原实现每次翻页都查 `pg_class.reltuples`。
- 仅缓存判定结果；阈值突破后最多 10 分钟才切换，风险可接受。

### 5. `invalidateFlowCache` 倒排索引
- `FlowModel` / `ForkFlowModel` 各自记录 `dispatchEvent` 产生的缓存键（`trackApplyFlowCacheKey`）。
- `invalidateFlowCache()` 优先遍历本模型/本 fork 的键集合，删除后从集合移除；集合为空时回退到原有全局扫描，
  兼容测试中直接写入 `applyFlowCache` 的场景。
- 消除原先“每个 JS/操作 cell 都扫描全部 fork × 全局 cache key”的 O(n²) 行为。
- 单测：`applyFlowCacheIndex.test.ts` 2 passed；原有 `flowModel` 139 passed / 1 skipped、
  `forkFlowModel` 72 passed 全部保持通过。

### 6. `ContentOrError` 提到模块级
- `FlowModelRenderer.tsx` 中该组件原先定义在 `FlowModelRendererCore` 函数体内，每次渲染都是新组件 type，
  导致 cell 子树强制卸载/重挂以及 `onMount/onUnmount` 事件风暴。
- 改为模块级组件并显式传入 `model`。
- `FlowModelRenderer.test.tsx` 4 passed。

## 验证结果（生产 dist，13010）

| 指标 | 优化前 | 优化后 |
|---|---|---|
| page1 行数 / cells | 200 / 2,600 | **50 / 650** |
| 全选 200/50 行 long task | 400–465 ms | **0–182 ms** |
| 单行勾选一次生效 | ✅ | ✅ |
| hover 预取请求 | 2（page + grid） | 2（不变） |
| 预取后 click → 可见 | 72 ms | **18 ms**，点击后 0 请求 |
| 缓存页 A→B→A | 77–187 ms | **19–61 ms**，0 请求 |
| console error | 0 | 0 |

测试：表格区块 55 passed；`FlowModelRepository` + `KeepAlive` 3 passed；`plugin-manager` + `app` 4 passed；
`parse-filter` 19 passed。

## 有意推迟（未在本次实施）

| 项 | 原因 |
|---|---|
| 空 auto-flow renderer 快路径 | `getEventFlows('beforeRender')` 把“无 `on` 且非 manual”的 flow 也算进来，几乎所有 cell 模型都有，快路径命中率极低；动态新增 flow 会带来漏执行风险。需先做 Profiler 证明每格 dispatch 数确实是热点。 |
| JS / 操作列 `shouldCellUpdate` | 短路条件需要“record + 模型版本”双条件，现有模型无稳定版本号；历史上 props 稳定化曾导致“勾选需点两次”回归。需在 Profiler 下证明收益后再做。 |
| 资源层短 TTL / 服务端 findOne / ACL meta 缓存 | 收益为 10–40ms 级；ACL 早退涉及越权风险，服务端缓存涉及多进程一致性和失效路径覆盖，需单独立项评审。 |
| 虚拟滚动 | 当前 `scroll.y=undefined` 时完全不生效；需要固定高度 + 门禁 + 3–5 周兼容矩阵，仅在 >500 行硬需求下做。 |
| 表格区块重构 / 换 TanStack | 成本 12–20+ 周且契约风险最高，不推荐。 |
