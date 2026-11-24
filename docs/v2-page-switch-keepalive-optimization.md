# V2 页面切换性能优化：KeepAlive 缓存治理

> 日期：2026-11-24
> 分支：perf/table-block-refactor

## 用户问题

V2 页面切换在 dev 和生产环境都很慢；每页从 200 条改为 10 条后仍然慢。

## 根因（trace 实测）

### 1. React 渲染长任务
V2 页面切换 trace：
- 单次 long task **1269ms**
- React scheduler `performWorkUntilDeadline` 最长 **11.7s**（并发渲染任务）
- 点击事件本身 2.4s

### 2. KeepAlive 缓存放大
`KeepAlive.tsx` 默认缓存 **5–15 个完整页面**（根据设备内存/CPU 核心数），每个页面保持挂载（`display:none`）。

切换页面时：
- 新页面完整挂载（表格、FlowModel、actions）
- **所有缓存页面都重新渲染**，因为 `children(renderedUid)` 每次产生新元素，`React.memo` 无法命中
- 缓存页含 200 行表格时，DOM/FlowModel/GC 成本线性累积

实测 DOM：切到 10 条/页后仍有 **2 个表格**（旧页 200 行 + 新页 10 行 = 210 行），旧页 width=0/height=0 但仍挂载。

### 3. 固定开销与行数无关
10 条/页切换仍有 **498ms 长任务**，说明除了行数，还有页面/FlowModel/表格布局的固定开销。

## 优化方案

### A. 缓存子元素引用
在 `KeepAlive` 内按 uid 缓存 `children(uid)` 返回的 React 元素：
- 当前活跃页面每次更新子元素（接收最新路由上下文）
- 非活跃页面复用同一元素引用 → `KeepAliveProvider` 的 `React.memo` 生效，不再重复渲染

### B. 缓存上限从 5–15 降到 2
`MINIMUM_CACHED_PAGES = 2`、`MAXIMUM_CACHED_PAGES = 2`：
- 保留当前页 + 上一页状态（表单/滚动位置）
- 避免大量历史页面同时挂载
- 超出 2 页时最早页面卸载，释放 DOM/FlowModel/fork

## 实测效果

### Dev（200 行 × 10 列）

| 方案 | 页面切换 long task | 改善 |
|---|---|---|
| 原始（缓存 5–15 + 每次重渲染） | 1269ms | — |
| 仅缓存子元素 memo | 1224ms | 首次切换收益小（主要成本是新页挂载） |
| 缓存上限 1（不保留旧页） | 412ms | -66% |
| **缓存上限 2 + 子元素 memo（最终）** | **442ms** | **-64%** |

### 生产（dist，200 行 + 50 行页面）

| 场景 | long task | wall |
|---|---|---|
| 首次切换（含页面模块懒加载） | 1506ms | 1576ms |
| **缓存后往返切换** | **330ms** | **354ms** |

最终方案保留上一页状态，同时将 dev 切换长任务降低约 64%；生产缓存后切换约 330ms。首次切换的 1.5s 主要来自页面模块首次懒加载，不属于 KeepAlive 重渲染问题。

## 功能验证

- ✅ KeepAlive 单测 2/2（含“非活跃页不重复渲染”新增测试）
- ✅ V2 表格单测 55/55
- ✅ eslint 无警告
- ✅ 缓存上限 2 仍保留 inactive page mounted（原有行为测试通过）

## 边界

- 超过 2 页的历史页面会被卸载，返回时需要重新挂载（可能短暂加载）
- 未解决浏览器刷新（完整重载）的 7s 架构成本——那是独立 HTML 入口问题，不是 KeepAlive
- 生产环境需重新构建 dist 后验证；预期同比例改善

## 提交

- `perf(client-v2): avoid re-rendering inactive KeepAlive pages and cap cache at 2`
