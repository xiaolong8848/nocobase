# V2 P0 / P1 优化实测验证

> 日期：2026-11-25
> 分支：`perf/table-block-refactor`（v2.2.51 fork）
> 环境：`APP_PORT=13010 APP_ENV=production`，数据库 `nocobase_perf_test`，测试表 `perf_table`
> 页面：`/v/admin/cpml0ns8jie`（A）、`/v/admin/hyi3co4hhm1`（B）、`/v/admin/0tp8e62tgq6`

## 测量方法

- 所有耗时均取自页面内 `performance.now()` / Resource Timing / `PerformanceObserver('longtask')`，
  在**单次 evaluate 中完成点击与计时**，不使用跨工具调用的 wall clock。
- “页面可见”判据：`location.pathname` + `document.title` 命中目标页，且可见 `tbody` 中有数据行。
- 请求数判据：`performance.clearResourceTimings()` 后统计新增的 `flowModels:findOne` / `perf_table:list` 资源条目。

## 构建与产物

| 项 | 结果 |
|---|---|
| 完整 `yarn build` | 通过（265.96s） |
| 定向重建（改动包 + `@nocobase/app`） | 通过（15–42s） |
| `dist/client/v/index.html` 预载脚本 | 9 个，合计 **9.66 MB raw / 约 2.77 MB gzip**（基线 10.4 MB / 3.0 MB） |
| `vendor-moment` 预载 | 已移除；入口仅剩 `str2moment` / `moment2str` 标识符与 `import('vditor')` 语句 |
| moment / Vditor 本体 | 仅存在于非预载的懒加载 chunk |
| 运行时 console error | 0 |

## P0 结果

### P0-1 页面与 grid 预加载

| 场景 | click → 可见 | 点击后关键请求 |
|---|---|---|
| 无 hover（程序化点击） | **576 ms** | 3：`findOne(page)`、`findOne(grid)`、`perf_table:list` |
| hover 预取后点击 | **72 ms** | **0** |

- 菜单 hover 同时预取页面 JSON、tab 的 grid JSON，并通过 `resolveModelTree()` 提前加载 model chunk。
- 修正：V2 页面的 tab uid 不在页面 JSON 的 `subModels.tabs` 中，而在 `desktopRoutes:listAccessible` 返回的
  `children[type=tabs].schemaUid`；现由菜单节点解析并传入 `prefetchFlowPage()`。
- 收益：约 **-87%**，且完全消除点击后的模型 JSON 请求。

### P0-2 缓存页激活不强制刷新

A→B→A 连续切换结果：

| 跳转 | 耗时 | 点击后 API 请求 |
|---|---|---|
| A → B | 158 ms | 0 |
| B → A | 77 ms | 0 |
| A → B（再次） | 187 ms | 0 |

- 语义未破坏：点击页面“刷新”按钮仍会发出 `perf_table:list?pageSize=200`。

### P0-3 setProps 浅比较

| 操作 | 首次点击即生效 | 主线程 long task |
|---|---|---|
| 单行勾选/取消（3 次） | ✅ 全部 | 61 / 89 / 85 ms（1 个 long task） |
| 全选/取消 200 行（2 次） | ✅ 全部 | 400 / 465 ms（4 个 long task） |

- 未出现此前“勾选需点击两次”的回归。

## P1 结果

| 项 | 结果 |
|---|---|
| P1-3 徽标请求延后 | `aiConversations:unreadCounts`、`userWorkflowTasks:listMine`、`asyncTasks:list` 均在 **894 ms** 发起；表格数据 `perf_table:list` 于 **892 ms** 完成。非关键请求已让位给首屏数据。 |
| P1-4 初始化并行 | `pm:listEnabledV2` 起于 **263 ms**，`app:getLang` 起于 **270 ms**，两者并行（原为串行瀑布）。`dataSources:listEnabled` 354 ms、`desktopRoutes:listAccessible` 408 ms、表格数据完成 892 ms。 |
| P1-6 去 Moment | 见“构建与产物”；`parse-filter` 单测 19/19 通过（含 isoWeek 修正）。 |
| P1-7 locale 缓存 | 冷缓存 `getLang` 179–206 ms、表格完成 547 ms；热缓存 `getLang` 109–125 ms（后台校验）、表格完成 424 ms。本环境 `getLang` 本身仅 20 ms，缓存主要减少关键路径阻塞，绝对收益受 HTTP 缓存影响。 |
| P1-5 fork 缓存索引 | 代码级改动：fork 记录自身 `applyFlowCache` 键与 `forkCache` 键，释放时 O(1) 清理，替代全局扫描；单测 `flowModel` 139 passed / 1 skipped、`forkFlowModel` 72 passed。 |

## 备注

- Chrome 扩展的后台标签中 `browse.hover` 未触发 React 合成 `onMouseEnter`；验证时使用合成
  `mouseover` 事件走同一 React 事件路径，确认预取逻辑生效。真实鼠标 hover 走相同处理函数。
- 相关单测：`FlowModelRepository` + `KeepAlive` 3 passed；`plugin-manager` + `app` 4 passed。
