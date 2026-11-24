# v2-only 部署：23 个 v1-only 插件升级优先级

> 分支：`perf/table-block-refactor`　|　日期：2026-11-24
> 依据：对全部 23 个无 `src/client-v2/` 的插件逐项审计（功能、服务端价值、v2 替代、缺失影响）

---

## 0. 结论先行

**必须先纠正一个数字：不是 87 个 v1-only，而是 87 个双运行时 + 23 个 v1-only（共 110 个插件）。** 缺失 v2 客户端的是这 23 个。

**核心结论：没有任何一个 v1-only 插件是"必须升级"的。** v2-only 部署在功能上是完整的：
- 6 个关键插件（flow-engine、system-settings、ui-schema-storage、data-source-main、error-handler、mcp-server）是**服务端关键**，但它们的 v1 客户端是空的/no-op，且服务端在 v2 部署中保留——**无需升级**
- 其余插件要么**已被双运行时插件替代**，要么**官方已废弃/排除**，要么**仅测试用**
- 只有 3–4 个"锦上添花"的功能在 v2 中缺失，按需移植

---

## 1. 决定性事实

1. **v2 根本不加载这些客户端**：modern client 调 `pm:listEnabledV2`，服务端过滤掉没有 `dist/client-v2/index.js` 的插件（`PluginManager.ts:59-82`、`options/resource.ts:148-159`）。所以缺失在 `/v/` 永远是**静默缺失**，不会崩溃。
2. **10 个被核心服务端明确排除在插件发现外**（`findPackageNames.ts:33-45`）：audit-logs、backup-restore、charts、disable-pm-add、mobile-client、mock-collections、multi-app-share-collection、notifications、snapshot-field、workflow-test。
3. **7 个自身 package.json 标记 deprecated**：audit-logs、backup-restore、block-template、charts、mobile、mobile-client、multi-app-manager。
4. **v2 核心仍调用其中 3 个的服务端 API**：`flowModels:*`（flow-engine，`FlowModelRepository.ts:170-217`）、`systemSettings:get/put`（`SystemSettingsSource.ts:76`）、`uiSchemas:insert`（`AdminLayoutMenuFlowUtils.ts:92-100`）。它们的客户端是空的——**只需服务端保留**。

---

## 2. 优先级总表

| 插件 | 功能 | v2 服务端价值 | v2 有替代? | 缺失影响 | 建议 | 依据 |
|---|---|---|---|---|---|---|
| **plugin-flow-engine** | flowModels 存储、flowSurfaces API、变量解析 | **关键** | 客户端用核心 flow-engine | 客户端无影响（服务端关键） | **服务端保留即可** | 客户端全空 `client/index.tsx:13-17`；服务端 `server/server.ts:112-167` |
| **plugin-system-settings** | 系统标题/Logo/语言 | **关键** | v2 核心有 `SystemSettingsPage` | 客户端无影响 | **服务端保留即可** | `src/client/index.ts:13`；`nocobase-buildin-plugin/index.tsx:370-384` |
| **plugin-ui-schema-storage** | uiSchemas 集中存储 | **关键** | 无（服务端基础设施） | 客户端无影响 | **服务端保留即可** | `src/client/index.ts:12`；`AdminLayoutMenuFlowUtils.ts:92-100` |
| **plugin-data-source-main** | 主数据源建模/迁移 | **关键** | 客户端有（data-source-manager v2） | 客户端无影响 | **服务端保留即可** | `src/client/index.ts:36-140`；`plugin-data-source-manager/src/client-v2/plugin.tsx:393-462` |
| **plugin-error-handler** | 友好错误信息 | 有 | 无需客户端 | 无 | **服务端保留即可** | `src/server/server.ts:47-54` |
| **plugin-mcp-server** | MCP 服务端 `/api/mcp` | 有 | 客户端不需要 | 无 | **服务端保留即可** | `src/client/models/index.ts` = `{}` |
| **plugin-disable-pm-add** | 锁定 `pm:add` | 有（策略） | 无需客户端 | 无 | **服务端保留** | `src/server/index.ts:18-24` |
| **plugin-backup-restore** | 备份恢复设置页 | 部分 | **有**（plugin-backups v2） | 无 | **丢弃** | 已废弃 |
| **plugin-charts** | v1 图表区块 | 部分 | **有**（data-visualization ±echarts） | 无 | **丢弃** | 已废弃/排除 |
| **plugin-block-template** | v1 区块模板 | 部分 | **有**（ui-templates v2） | 低 | **丢弃** | 已废弃 |
| **plugin-mobile** / **plugin-mobile-client** | v1 移动端 | 部分 | **有**（ui-layout v2） | 无 | **丢弃** | 已废弃，官方说明被 ui-layout 替代 |
| **plugin-notifications** | v1 通知 | 部分 | **有**（notification-manager/email/in-app） | 无 | **丢弃** | 被排除 |
| **plugin-snapshot-field** | 快照字段 | 部分 | 部分（仅 label） | 低 | **丢弃** | 已废弃/排除 |
| **plugin-multi-app-manager** | 子应用管理 | 有（子应用生命周期） | 部分（v2 有 AppSwitcher 但无管理页） | 低（单应用无影响） | **丢弃**（多应用场景再移植） | 官方称"testing/demo only" |
| **plugin-multi-app-share-collection** | 跨应用共享集合 | 部分 | 无（但被排除） | 低（静默） | **丢弃** | `findPackageNames.ts:41` |
| **plugin-hello** | 示例插件 | 无 | 有（example 插件） | 无 | **丢弃** | 示例 |
| **plugin-mock-collections** | 测试夹具集合 | 测试用 | N/A | 无 | **丢弃** | `findPackageNames.ts:40` |
| **plugin-workflow-test** | 工作流测试包 | 测试用 | N/A | 无 | **丢弃** | `findPackageNames.ts:44` |
| **plugin-audit-logs** | 审计日志区块 | 有（DB hooks 写 auditLogs） | **无** v2 审计 UI | 中（合规功能静默缺失） | **按需升级**（合规强需求时） | 已废弃/排除；`src/client/index.ts:27-45` |
| **plugin-block-multi-step-form** | 多步表单区块 | 无（服务端全 no-op） | **无** v2 替代 | 中（区块类型缺失） | **建议升级**（锦上添花） | `src/client/index.tsx:23-87`；`src/server/plugin.ts:1-19` |
| **plugin-custom-variables** | 自定义聚合变量 | 部分 | **部分**（v2 有上下文变量但无自定义聚合变量注册） | 中 | **建议升级**（需新建 v2 变量 provider，非照搬） | `src/client/index.tsx:43-62`；v2 无 `customVariables` 匹配 |
| **plugin-graph-collection-manager** | ER 图可视化建模 | 部分 | **无** v2 替代 | 低–中（工作量大） | **低优先级升级**（按需） | `src/client/GraphDrawPage.tsx` |

---

## 3. 最小移植集合（按需求）

### 必须移植（MUST）：**无**

v2-only 部署功能完整。6 个服务端关键插件只需保留服务端（其客户端为空或已被 v2 核心替代）；其余均已废弃、被替代或仅测试用。

### 锦上添花（按需移植，都是 `/v/` 下的静默能力缺口）

1. **plugin-block-multi-step-form** — 多步表单区块，v2 无替代，移植成本中等
2. **plugin-custom-variables** — 自定义聚合变量，v2 无等价，需新建 v2 MetaTreeNode provider（非照搬）
3. **plugin-graph-collection-manager** — ER 图编辑器，v2 无替代，工作量最大
4. 条件性：
   - **plugin-audit-logs** — 若有审计合规硬需求（官方已废弃且无 v2 后继）
   - **plugin-multi-app-manager / -share-collection** — 仅多应用场景（均已废弃/排除）

### 废弃/测试用（直接丢弃）

backup-restore、charts、block-template、mobile、mobile-client、notifications、snapshot-field、disable-pm-add（服务端可留作策略）、mock-collections、workflow-test、hello

---

## 4. plugin-flow-engine 专项确认（之前的关键疑问）

- **v1 客户端什么都不做**：`afterAdd(){}`、`beforeLoad(){}`、`load(){}` 全空（`src/client/index.tsx:13-17`）；build 配置只把 locale 拷进 legacy bundle
- **服务端才是产品本体**：注册 `flowModels` 资源（`server/server.ts:112-167`）、运行时无关的 `flowSurfaces` 创作 API（`server/flow-surfaces/index.ts`）、变量解析（`server/plugin.ts:94-202`）、flowSql
- **v2 直接消费 `flowModels:*`**（`FlowModelRepository.ts:170-217`）；无任何 v2 客户端文件 import flowSurfaces（验证：0 匹配）
- **结论：服务端 API 对 v2 创作已足够，无需客户端移植；服务端必须保留（builtIn）**

---

## 5. 最终答案

**Q：87 个 v1-only 插件中哪些必须升级到 v2？**

**A：数字应为 23 个 v1-only；其中没有任何一个是 v2 功能完整性所必需的。**

- 真正关键的 6 个是**服务端关键**，客户端为空/已替代，保留服务端即可
- 3 个（block-multi-step-form、custom-variables、graph-collection-manager）是**按需移植**的能力缺口
- 其余均已废弃、被双运行时插件替代或仅测试用，可直接丢弃

**对表格性能优化项目的意义**：这些插件与 v2 表格重构无关（它们或无 v2 客户端、或被替代、或仅服务端）。专注 v2 表格渲染层即可，无需考虑为它们做兼容。
