# V2 表格后续优化评估

> 日期：2026-11-25
> 分支：`perf/table-block-refactor`（v2.2.51 fork）
> 依据：生产 13010 实测（`docs/v2-p0p1-verification.md`）+ 渲染热路径 / 数据层 / 虚拟滚动三份代码审计
> 本文只做评估，不含代码改动

## 1. 现状与收益结构

| 指标（生产 dist，实测） | 当前值 |
|---|---|
| 首屏 DCL / load | 437 ms |
| 表格 cell 数（200 行/页） | **2,614**，DOM 节点 18,775 |
| 表格 cell 数（50 行/页） | 650 |
| KeepAlive 缓存两页后 DOM | 23,569 节点（隐藏页仍挂载 2,600 cells） |
| 菜单 hover 预取后 click → 可见 | **72 ms**，点击后 0 请求 |
| 无预取 click → 可见 | 576 ms，3 请求 |
| 缓存页 A→B→A | 77–187 ms，0 请求 |
| 单行勾选 long task | 61–89 ms |
| 全选 200 行 long task | 400–465 ms |
| 全选 50 行 long task | **64–104 ms** |
| 服务端 `perf_table:list` cost | min 6 / median 18 / max 40 ms |
| 服务端 `flowModels:findOne` cost | min 2 / median 8 / max 60 ms |

**结论**：网络层已接近下限（10–40ms 级），继续优化的主战场是 **cell 渲染管线** 和 **挂载数量**。
但“减少挂载”只有两条路：减小 pageSize（零代码）或虚拟滚动（大工程）。

## 2. 优先级总表

| 序 | 优化项 | 预估收益 | 工作量 | 风险 | 建议 |
|---|---|---|---|---|---|
| 1 | 配置层：pageSize 200 → 50 | 全选 **400→64–104ms**（-75~85%），cells -75% | 0（配置） | 无 | **立即做** |
| 2 | 修复配置保存后 hover 预取失效 | 恢复 576ms → 72ms | 0.5 天 | 低 | **立即做** |
| 3 | JS 列 / 行操作列补 `shouldCellUpdate` | 勾选场景 10–20% | 1–2 天 | 中 | **先做** |
| 4 | 服务端 simplePaginate 决策缓存 | 1–3ms + 少 1 条 SQL/次 | 0.5–1 天 | 低 | **先做** |
| 5 | query 变化白名单化（去掉伪强制刷新） | 带参跳转少 1 次 list + 200 行渲染 | 1 天 | 中 | **先做** |
| 6 | 空 auto-flow 的 renderer 快路径（原 P0-3 未做部分） | 首屏/翻页 15–30%（估算，未实测） | 3–5 天 | 中 | 下一步主线 |
| 7 | `invalidateFlowCache` 倒排索引 | 翻页 10–25%，降 long task 峰值 | 3–5 天 | 中高 | 下一步主线 |
| 8 | cell 分配治理（`JSON.stringify` / meta factory / 组件类型） | 5–15% + GC 改善 | 3–5 天 | 中 | 视 Profiler 结果 |
| 9 | 资源层 list 短 TTL + 跨 block in-flight | 多 block / 回翻页场景 6–40ms/次 | 3–5 天 | 中 | 按需 |
| 10 | 服务端 `flowModels:findOne` 缓存 | 10–20ms/次（未预取入口） | 2–4 天 | 中高（多进程） | 按需 |
| 11 | ACL meta 全权限早退 + 参数缓存 | 服务端 cost 30–60%（5–12ms） | 3–5 天 | **高（越权风险）** | 谨慎，需安全评审 |
| 12 | 选区单一数据源（去本地副本） | 勾选渲染次数理论减半 | 1–2 周 | **高（历史回归点）** | 暂缓 |
| 13 | 虚拟滚动受控原型 | cells -88~92%（200 行） | 3–5 周 | 中高（兼容矩阵） | 仅在固定高度硬需求时 |
| 14 | props 稳定化 / 表格区块重构 / 换 TanStack | 不确定 | 12–20+ 周 | 最高 | **不推荐** |

## 3. 详细评估

### 3.1 立即可做（低风险，1 天内）

**① pageSize 200 → 50**
同一份 `perf_table`，page2 已是 50 行/页：cells 650 vs page1 的 2,600；全选 long task 64–104ms vs 400–465ms。
这是投入产出比最高的一项。代价是每页可见数据变少，需确认业务是否接受；4998 行数据下 50 行/页 = 100 页。

**② 修复配置保存后 hover 预取失效（真实缺陷）**
`prefetchFlowPage.ts` 的模块级 `prefetchedPageUids` Set 不会在 `FlowModelRepository.save/destroy/move/duplicate` 时清理
（repository 只清 `prefetchedFindOne`）。配置保存后同一菜单 hover 直接 early-return，首次切换退化到 576ms。
修复：导出 `clearPrefetchPageUids()`，在 repository 的四个写操作中调用；或把 Set 换成带 TTL 的 Map。

**③ 服务端 `simplePaginate` 决策缓存**
`list.ts` 每次翻页都调 `getEstimatedRowCount()` 查 `pg_class.reltuples`，但 `SIMPLE_PAGINATION_LIMIT=300000`，
4998 行永远走简单分页。缓存首次决策即可省一条 SQL。风险是表体积突增时不能及时切换，可接受。

**④ query 白名单**
`CollectionBlockModel.onActive()` 用整个 `location.search` 做 hash，任何无关参数（时间戳、tabUid、埋点）变化都触发
`rerender({useCache:false})` → 一次 list + 200 行重渲染。建议只剔除明确无关的白名单参数，不做全量规范化，避免漏掉
真正影响联动的 query key。

### 3.2 下一步主线（中风险，1–2 周）

**⑤ 空 auto-flow 的 renderer 快路径 —— 原 P0-3 只做了一半**
`FlowModelRendererWithAutoFlows` 无条件调用 `useApplyAutoFlows`，后者为每个 cell 建 ahooks `useRequest`（8 个插件 hook）。
实际上大量 model 的 `beforeRender` flow 只是 `fieldSettings` 参数校验。
关键约束：必须保留 `model.useHooksBeforeRender()` 与 hook 调用顺序；用“始终调用 useRequest + manual 条件”避免
React hooks 规则问题；动态新增 flow（DynamicFlowsIcon / rebuildFieldSubModel）时必须切回完整路径。
这是当前唯一能显著降低**每格固定成本**的改动，建议先做 Profiler 基线再上。

**⑥ `invalidateFlowCache` 倒排索引**
现实现是 O(fork 数 × 全局 cache key 数)：JS 列（≤600 fork）和操作列（≤200 fork）每个 cell render 都调一次。
P1-5 的 fork 自身 key 索引解决的是 dispose，解决不了 master 主动失效所有 fork。需要按
`(uid, forkId, eventName)` 建倒排索引，或只失效当前行 fork。改错会导致 JS 列内容不更新，必须回归“改 JS 代码后每行立即刷新”。

**⑦ cell 分配治理**
- `JSColumnModel.getRecordRenderSignature()` 对整行 `JSON.stringify`，并把结果塞进 React key；200 行 × JS 列数 次。
- 每个 cell render 新建 `PropertyMetaFactory` + 3~5 次 `defineProperty`，meta 缓存以 factory 为 key → 完全不复用。
- `FlowModelRendererCore` 在函数体内定义 `ContentOrError`，每次 render 都是新组件 type → 子树强制卸载/重挂，
  连带 `onMount/onUnmount` 与 `model:mounted/unmounted` 事件风暴。
这三项合计 5–15%，主要是 GC 和生命周期抖动，风险中等，适合与 ⑤ 一起做并共用 Profiler 验收。

**⑧ JS 列 / 行操作列补 `shouldCellUpdate`**
数据列已有短路，勾选时这两类列的 200 个 cell 仍全部重渲。短路条件必须是 `record identity + 模型/flow 版本`，
不能只比 record，否则联动改按钮显隐不刷新。

### 3.3 按需（有明确场景才做）

**⑨ 资源层短 TTL 缓存**
在 `MultiRecordResource.refresh()` 外包一层 `Map<key,{at,data,meta}>` + in-flight Promise，TTL 500–1500ms，
`force` 旁路，dirty version / 写操作失效，key 必须含 user/role/dataSource。
针对同页多个同集合 block、筛选来回切、回翻已访问页。风险是外部系统写库未打 dirty 时最多 1.5s 旧数据。
不建议引入完整 react-query provider；资源层是最小侵入点。

**⑩ 服务端 `flowModels:findOne` 缓存**
一次 grid `findOne` 约 3 条闭包表 SQL，median 8ms / max 60ms。复用 `repository.setCache(ctx.cache)`，
按 `m_${uid}` 缓存，`includeAsyncNode` 进 key，save/move/destroy 清祖先 key。
多进程部署必须确认 `ctx.cache` 是 Redis，否则节点间脏读。

**⑪ ACL meta 早退（谨慎）**
`with-acl-meta.ts` 即使三个动作都 `allAllowed` 仍执行 `WHERE id IN (200 ids)` + CASE WHEN。
root 场景可省 5–12ms/list。但 owner-scope / 字段级 ACL 强依赖用户、角色、记录，缓存 key 漏一项就是越权显示行操作。
**必须先做安全评审和角色交叉测试**，不建议作为普通性能项推进。

### 3.4 大工程 / 不推荐

**⑫ 虚拟滚动**
现状：`scroll.x='max-content'` 恒定，`scroll.y` 默认 `undefined`（`heightMode=default`），rc-virtual-list 的
`useVirtual = !!(height && itemHeight)` 为 false → 即使打开 `virtual` prop 也不生效。
`virtual` 链路已存在但设置项是注释掉的 `uiSchema` 步骤（活跃步骤都用 `uiMode`），没有可用开关。
三个 body 组件非 forwardRef 且渲染 `<tbody>/<tr>`，rc-virtual-list 传 ref 会抛错。

最小侵入方案：在 `HighPerformanceTable` 加门禁
`canVirtual = virtual && 数字 scroll.x/y && 无树 && 无拖拽 && 无可编辑列 && 所有列宽为数字 && 非设计态`，
虚拟分支**不传** `body.wrapper/row/cell` 覆盖，让 rc-table 回退到 div；非虚拟分支完全不动。
收益：200 行 cells 2,614 → ~160–240（-88~92%），初始 fork 驻留 -85~90%，但累计 fork 不减少（上限已 601）。
代价 3–5 周 + 兼容矩阵（树、拖拽、快速编辑、联动样式、固定列、移动端）。
**结论：不作为默认下一步；只有“>500 行单表 + 必须固定高度”的硬需求才立受控原型。**

**⑬ 选区单一数据源 / props 稳定化 / 表格重构**
`docs/v2-optimization-options-priority.md:87-100` 已记录：`pagination` memo、selectedKey join/split、
`TableBlockContent React.memo`、`MemoBodyRow` 曾导致“勾选需点两次”的回归，已回退。
选区目前 resource meta + 本地 state 双份，理论上可减半渲染，但同样是最敏感区域。
表格区块重构 / 换 TanStack 成本 12–20+ 周且契约风险最高，不推荐。

## 4. 推荐执行顺序

1. **配置层 pageSize 50 + 修 prefetch 失效标记 + simplePaginate 缓存**（半天，零/低风险）
2. **Profiler 基线**：记录 cell render 次数、`FlowExecutor.dispatchEvent` 次数、`invalidateFlowCache` key 迭代数
3. **renderer 空 flow 快路径 + invalidateFlowCache 倒排索引**（主线，1–2 周）
4. **cell 分配治理 + JS/操作列 shouldCellUpdate**（3–5 天）
5. **按实测决定**：仍不达标且有固定高度硬需求 → 虚拟滚动原型；否则停止，转配置层治理

## 5. 验证协议（强制）

- 生产 dist，固定数据；所有耗时在**单次 `page.evaluate` / `browse.eval` 内**用 `performance.now()` +
  Resource Timing + `PerformanceObserver('longtask')` 采集，禁止跨工具调用 wall clock。
- 功能回归必测：单行勾选一次生效、全选/取消 200 行、翻 5 页后 fork ≤601、JS 列编辑后立即刷新、
  联动规则改按钮显隐、快速编辑写回、批量删除、树展开、拖拽排序。
- 服务端项需对比 SQL 条数与 `cost=` 日志，并做不同角色/owner 权限交叉验证。
