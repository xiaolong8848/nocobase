# V2 页面剩余优化选项与优先级

> 日期：2026-11-25
> 分支：perf/table-block-refactor
> 说明：已完成的优化不重复列入；未标注“实测”的收益均为代码审计估算，需用生产 dist 验证。

## 已完成（基线）

- ✅ 表格勾选 `shouldCellUpdate`：488ms → 101ms（-79%）
- ✅ fork 缓存上限：多页浏览稳定 601，消除无界增长
- ✅ KeepAlive：缓存 5–15 → 2 + 子元素 memo，dev 切换 1269ms → 442ms（-64%）
- ✅ 生产缓存后页面切换：约 330ms；首次切换约 1.5s（页面模块懒加载）

---

## 优先级总表

| 优先级 | 优化项 | 目标 | 预估收益 | 工作量 | 风险 | 建议 |
|---|---|---|---|---|---|---|
| **P0-1** | 页面 JSON + model chunk 预加载 | 首次切换 1.5s | **30–50%**，约 0.4–0.9s | 2–4 天 | 中 | **先做** |
| **P0-2** | KeepAlive 激活时复用资源数据 | A→B→A 多余刷新 | **15–35%**，约 50–120ms；每块少 1 次 list | 1–3 天 | 中 | **先做** |
| **P0-3** | 移除 per-cell 空 beforeRender / 相同 props 写入 | 2000+ cell 渲染 | **15–30%**，大表更明显 | 3–5 天 | 中 | **先做** |
| **P1-1** | 受控表格虚拟滚动 | 大表 DOM/挂载 | **85–92% cell 减少**；大表挂载 40–70% | 原型 1–2 周，稳健 3–5 周 | 中 | 大表场景 |
| **P1-2** | 重 UI 懒加载（Vditor/CodeMirror/AI/Inbox） | 首包 17MB | 初始 JS **10–25%**，冷解析 5–15% | 1–2 周 | 中 | 首屏优化 |
| **P1-3** | 延后非关键 topbar API | 初始化瀑布 | **50–150ms**，减少网络竞争 | 2–4 天 | 低 | 易做 |
| **P1-4** | 初始化并行化 | 启动关键路径 | **100–400ms+** | 3–6 天 | 中 | 易做 |
| **P1-5** | fork 缓存索引 + 全局扫描移除 | 25 页浏览/GC | 翻页 **10–30%**，降低堆占用 | 1 周 | 中 | 大表 |
| **P1-6** | 去 Moment + Lodash 去重 | 首包体积 | Moment 约 **78KB gzip** + Lodash 去重 | 2–5 天 | 中 | 易做 |
| **P1-7** | locale session cache | 热刷新 | **300–900ms**（若 app:getLang 是瓶颈） | 2–4 天 | 中 | 热刷新 |
| **P2-1** | 每页 KeepAlive / refreshOnActivate 策略 | 内存与返回速度 | 混合；主要降内存 | 2–4 天 | 中 | 按需 |
| **P2-2** | model JSON 单次预取缓存 + tab anchor 批量 | 页面/菜单水瀑布 | 少 1+ findOne/页 | 1–2 周 | 中 | 按需 |
| **P2-3** | 路由树/lazy promise 缓存 | 路由匹配 | 小幅；消除空白 lazy 区间 | 2–3 天 | 低 | 易做 |
| **P2-4** | 列/行隔离 + display-only 快路径 | 复杂表格 | **20–40%** | 3–6 周 | 中 | 谨慎 |
| **P2-5** | RequireJS globals/icons 瘦身 | 首包 | **5–15%** | 2–4 周 | 高 | 谨慎 |
| **P2-6** | SWR 渲染 + 局部 transition | INP/体感 | 感知提升，CPU 不减 | 1–2 周 | 中 | UX |
| **P3-1** | 整插件路由感知懒加载 | 启动 | 潜在很大 | 4–8+ 周 | 高 | 暂缓 |
| **P3-2** | 全表重写 / 通用持久 API 缓存 | — | 不确定 | 12–20+ 周 | 高 | **不推荐** |

---

## P0 详解（下一步推荐）

### P0-1 页面预加载

**现状**：普通 `/admin/:name` 页面**不是** React.lazy 路由。首次切换成本来自：
1. `flowModels:findOne` 页面 JSON
2. `FlowEngine.resolveModelTree()` 动态 import 插件 model chunk
3. 模型实例化 + beforeRender + block 数据

**改动点**：
- `RouterManager.tsx:242-269,274-323`：缓存 `componentLoader()` promise，增加 `prefetch(pathname)`
- `FlowEngine.tsx:713-757`：暴露只 import 类、不实例化的 `preloadModelTree(data)`
- `FlowModelRepository.tsx:148-220`：短 TTL `prefetchOne(query)`，save/destroy/角色变更失效
- `AdminLayoutMenuUtils.tsx:572-839`：菜单 hover/focus 预取
- `AdminLayoutComponent.tsx:510-527`：路由就绪后 idle 预取落地页/前 1–2 页

**约束**：只预取有权限页面；不实例化 model；不预取全部页面；尊重 saveData。

### P0-2 KeepAlive 激活不强制刷新

**现状**：`BaseLayoutRouteCoordinator.ts:265-292` 调用 `activate(true)`，使每个 block 的 `onActive(true)` 强制刷新。页面和 resource 数据其实已缓存。

**改动**：
- 改为 `activate()`（非强制）
- 保留 query 变化、dirty version、manual refresh 的强制刷新
- 可选 route option `refreshOnActivate`

**验证**：A→B→A 时 block list 请求为 0；query 变化/写入仍刷新。

### P0-3 per-cell 空流程与重复 props 写入

**现状**：
- `FlowModelRenderer.tsx:149-158` 每次调用 `useApplyAutoFlows`
- `useApplyAutoFlows.ts:21-45` 即使没有 `beforeRender` flow 也创建 ahooks `useRequest`
- `FieldModelRenderer.tsx:76-87` 每次渲染后 `model.setProps(modelProps)`
- 200×10 = 2000+ hook/effect/update cycles

**改动**：
- 无 `beforeRender` flow 的 model 走直接渲染路径（仍调用 `useHooksBeforeRender`）
- `setProps` 前做浅比较，引用相同不写入
- 动态 flow 增加时安全切换渲染路径

**验证**：Profiler 统计每格 render/effect 数；覆盖 linkage、JS field、permission 变化。

---

## 上一轮教训：不要重做 naive props 稳定化

此前尝试过：
- `pagination()` memo
- `selectedRowKeys` join/split
- `TableBlockContent React.memo`
- `MemoBodyRow`

结果：
- 勾选性能无改善
- 引入“勾选需点击两次”的回归

因此 P0-4“稳定 table props”**不再列为优先项**。只有在 Profiler 证明 props churn 是热点、且不破坏选择状态时才做；优先做 P0-3 的 renderer 层治理。

---

## 首屏/启动关键路径（P1-3 / P1-4）

当前初始化瀑布（源码推导）：

```
app:getLang
  → pm:listEnabledV2
    → remote plugins load
      → auth / roles:check
        → dataSources:listEnabled → collections:listMeta
          → desktopRoutes:listAccessible
            → flowModels page → grid → table data
```

可并行/延后：
- `pm:listEnabledV2` 与 `app:getLang` 并行
- auth 后 ACL / routes / metadata 并行
- page 与 active tab grid locator 并行
- theme/systemSettings/appInfo/AI unread/workflow/inbox/asyncTasks 延后到首屏后
- workflow badge 改用 `userWorkflowTaskStats:listMine`

---

## 大表终极方案：虚拟滚动（P1-1）

当前不能直接开启， blockers：
- `scroll.x='max-content'` 会被 rc-table 强转为 1
- filler column 无数字宽度
- `body.wrapper` 是 `<tbody>`，virtual 需要 forwardRef div
- `body.row` 是 `<tr>`，virtual 行是 div
- `scroll.y` 默认 undefined
- tree / drag / quick edit 未验证

**安全范围**：平坦 + 非拖拽 + 非编辑 + 全数字列宽 + 数字 scroll.x/y。
**不兼容时继续非虚拟**。

---

## 推荐执行顺序

1. **P0-1 页面预加载**（先做，直接针对首次切换 1.5s）
2. **P0-2 KeepAlive 激活复用数据**（小改动， cached switch 再降 50–120ms）
3. **P0-3 renderer 空流程/重复写入治理**（表格挂载最大剩余成本）
4. **P1-3 / P1-4 非关键 API 延后 + 初始化并行**（低风险启动优化）
5. **P1-1 大表虚拟滚动原型**（仅平坦非编辑表）
6. 之后再评估 bundle 瘦身、fork 索引、locale cache

## 验证指标

每次优化必须用生产 dist + 固定数据，记录：
- 首次/缓存切换 click→interactive
- page JSON / model chunk / block data ready 时间
- long task max/total、INP p50/p95
- React Profiler render/effect 数
- DOM cell 数、fork 总数、heap
- API 请求数/duration/server cost
- 初始与路由 compressed bytes

**禁止**用跨工具调用 wall clock 判断性能。
