# V2 表格：仅低风险改进项评估与实施

> 日期：2026-11-25
> 分支：`perf/table-block-refactor`
> 约束：**只做低风险项，高风险项一律不做**

## 本轮评估结论

剩余候选中真正“无回归面”的只有 3 项，已全部实施；其余均有功能/安全/一致性风险，明确排除。

### 已实施（低风险）

| 项 | 改动 | 风险说明 |
|---|---|---|
| locale 后台校验不重复应用 | `LocalePlugin.refreshLocale()` 比较新旧数据，完全相同则跳过 `applyLocaleData()` | 内容一致时跳过，语义不变；避免 `defineProperty` 清缓存、`i18n.changeLanguage`、`addResources` 引起的二次渲染 |
| 请求默认空参数剔除 | `ApiResource.getRefreshRequestOptions()` 删除 `null` / `undefined` / 空数组参数 | 这些参数原先序列化为空键，服务端按“未传”处理，行为等价 |
| 缓存失效空集合早退 | `FlowModel` / `ForkFlowModel.invalidateOwnApplyFlowCache()` 在全局 cache 为空时直接返回 | 空集合上扫描无意义，早退不改变结果 |

请求 URL 实测：
- 前：`/api/perf_table:list?filterByTk&sort[]=-createdAt&except&whitelist&blacklist&page=1&pageSize=50&tree=false`
- 后：`/api/perf_table:list?sort[]=-createdAt&page=1&pageSize=50&tree=false`

### 明确排除（不做）

| 项 | 排除原因 |
|---|---|
| 空 auto-flow renderer 快路径 | `getEventFlows('beforeRender')` 会把所有“未声明 `on` 且非 manual”的 flow 计入，几乎所有 cell 模型都命中；快路径几乎不生效，动态 flow 新增时反而可能漏执行 |
| JS / 操作列 `shouldCellUpdate` | 缺少稳定的模型版本号做双条件；历史上 props 稳定化曾导致“勾选需点两次”回归 |
| 资源层短 TTL 缓存 | 外部系统写库未打 dirty 标记时会读到旧数据；TTL 与失效语义属于行为变更 |
| 服务端 `flowModels:findOne` 缓存 | 多进程部署需 Redis，否则节点间脏读；save/move/destroy 失效路径需全部覆盖 |
| ACL meta 全权限早退 | owner-scope / 字段级 ACL 强依赖用户、角色、记录；缓存 key 漏一项即越权显示行操作 |
| 虚拟滚动 | 当前 `scroll.y=undefined` 时完全不生效；需固定高度 + 门禁 + 3–5 周兼容矩阵 |
| 选区单一数据源 / props 稳定化 / 表格区块重构 | 历史回归点 + 持久化契约风险，属于高风险结构性改动 |

## 验证（生产 dist，13010，最终复测）

| 指标 | 结果 |
|---|---|
| 首屏 DCL / load | 427 ms |
| page1 行数 / cells / DOM 节点 | 50 / **650** / **5,125**（优化前 200 / 2,614 / 18,775） |
| `perf_table:list` 请求 URL | `?sort[]=-createdAt&page=1&pageSize=50&tree=false`（4 个空参数已剔除） |
| 服务端 `perf_table:list` cost | 18 / 21 ms（连续两次） |
| 初始化并行 | `pm:listEnabledV2` 421 ms 起、`app:getLang` 427 ms 起（并行） |
| 徽标请求 | 778 / 864 ms 发起，晚于首屏表格数据 |
| 单行勾选 | 一次点击生效，long task 59 ms（首次），后续 0 ms |
| 全选 50 行 | 一次点击生效，long task 0 ms |
| hover 预取 | page + grid 共 2 个请求 |
| 预取后 click → 可见 | **19 ms**，点击后 **0 请求** |
| 缓存页 A→B / B→A | 67 ms / 19 ms，**0 请求** |
| console error | **0** |

测试全部通过：表格区块 55；`flowModel` 139 passed / 1 skipped；`forkFlowModel` 72；
`applyFlowCacheIndex` 2；`FlowModelRenderer` 4；`apiResource` + `multiRecordResource` 8；
`prefetchFlowPage` 3；`nonDataQuerySignature` 3；`parse-filter` 19。

## 关联文档

- `v2-table-next-optimization-evaluation.md` — 全量选项评估（含高风险项）
- `v2-table-optimization-implementation.md` — 上一轮已实施的低/中风险项
