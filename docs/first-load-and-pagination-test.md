# 首次数据加载与翻页测试（dev 环境，5000 条数据）

> 日期：2026-11-24
> 环境：dev server 13001（生产实例 13010 已关闭）
> 数据：perf_table，4998 条，200 行/页 × 10 字段，2614 cells
> 测量方法：页面内 `performance` API + 服务端日志 `cost=`（不受 browser 工具 CDP 往返延迟影响）

## 首次加载

| 场景 | DOMContentLoaded | FCP | 数据 API | 结果 |
|---|---|---|---|---|
| dev server 重启后冷启动首次访问 | 279 ms | 924 ms | — | 200 行渲染 ✅ |
| 缓存后重新加载 | 987 ms | 1640 ms | 27 ms | 200 行渲染 ✅ |
| 带新时间戳参数加载 | 329 ms | 756 ms | 26 ms | 200 行渲染 ✅ |

JS 资源：88–103 个，全部缓存命中（transferSize=0），最慢单个 33–46ms。

**结论：首次加载不慢**（DOM <1s，FCP <1.7s）。此前的"45 秒"是 browser 工具 CDP 空闲后重连延迟（实测 `evaluate(1+1)` 首次 37s、后续 26ms）。

## 翻页

| 指标 | 数值 |
|---|---|
| 数据 API 服务端 cost | **40–67 ms**（服务器日志） |
| 单页传输量 | 73 KB |
| API performance.duration | 40–67 ms |

服务端日志实测（连续翻页）：
```
page=3  cost=49ms   page=4  cost=40ms   page=5  cost=63ms
page=6  cost=67ms   page=7  cost=65ms   page=9  cost=50ms
```

**结论：翻页数据加载很快**（每次 <70ms）。此前的"20–52 秒"间隔是我两次工具调用之间的间隔（含 CDP 重连延迟 + 我的分析时间），不是翻页耗时。

## 为什么之前测出"慢"（测量方法论更正）

`tools.browser.evaluate` 在 CDP 空闲后会重连，首次调用延迟可达 37–49 秒：
```
连续 3 次 evaluate(1+1): [37301ms, 26ms, 12ms]
```
跨工具调用测 wall clock 会把这个延迟算进去。正确方法：
1. 页面内 `performance.getEntriesByType('resource')` 的 `duration`
2. 服务端日志的 `cost=`
3. 单次 evaluate 内的 `performance.now()`

## 真实性能结论

- ✅ 首次加载：DOM <1s、FCP <1.7s
- ✅ 翻页数据：<70ms/次
- ✅ 勾选交互：Phase 1 优化后 ~100ms（之前实测）
- ✅ fork 缓存：Phase 2 优化后稳定 601
- ⚠️ v1↔v2 整页跳转 ~7.3s 是真实的（两个独立 HTML 入口，架构问题）

**表格相关性能均良好，无需进一步优化。** 唯一真实的慢是 v1↔v2 切换（架构层面，见 `v1-to-v2-migration-assessment.md`）。

## 工具使用建议

后续性能测试一律使用：
- `performance.getEntriesByType('resource')` 的 duration
- 服务端 `cost=` 日志
- 单次 evaluate 内的 performance.now()

**禁止**用跨工具调用的 wall clock 判断页面性能。
