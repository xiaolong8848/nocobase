# V1 页面迁移到 V2：工具化可行性与工作量评估

> 日期：2026-11-24
> 分支：perf/table-block-refactor
> 依据：全仓库审计（源码 / CLI / flowSurfaces API / CHANGELOG / docs）

---

## 0. 结论先行

| 问题 | 答案 |
|---|---|
| 有官方批量转换工具吗？ | ❌ **没有**——CLI、API、UI、文档中均不存在 |
| V2 能原生渲染 V1 页面吗？ | ❌ **不能**——`/v/` 会重定向/警告/404 |
| 能自建批量转换工具吗？ | ✅ **结构上可行**，写入端可用 `flowSurfaces:applyBlueprint` |
| 工作量 | 骨架转换器数周；高保真批量转换数月，且部分页面无法转换 |

**核心建议**：不要指望一键转换。优先按页面价值分批**手工重建**（用 `applyBlueprint` 半自动化），只对简单标准页面尝试脚本化转换。

---

## 1. 为什么没有现成工具

### 1.1 官方明确只"建议迁移"，不提供工具
- `CHANGELOG.md:691` — "If your application still mainly uses V1 pages, we recommend migrating your pages and plugins before switching to the new `/v/` entry."
- `CHANGELOG.md:697` — "`/v/` build ... can no longer create or render V1 pages and blocks."
- `CHANGELOG.md:727` — "Pages created with Page V1 are no longer displayed under `/v/`."
- `CHANGELOG.md:744-746` — 只链接了通用"客户端插件开发"文档，无页面转换工具。

### 1.2 CLI 无任何转换命令
- `nocobase-v1` 命令注册表（`packages/core/cli-v1/src/commands/index.js:17-47`）：`build/dev/start/upgrade/e2e/...` —— **无 migrate/convert**
- 全局 `nb` CLI topics：`api/app/backup/config/db/env/license/plugin/proxy/revision/scaffold/self/session/skills/source` —— **无 page migration**
- `nb scaffold migration` 只生成插件数据库迁移文件；`nb api migration` 是备份恢复包，与页面无关

### 1.3 flowSurfaces 无"从 V1 schema 转换"的入口
- action 注册表（`flow-surfaces/constants.ts:23-76`）50+ actions：`applyBlueprint`/`exportBlueprint`/`listTemplates`/`compose`/`addBlock`...
- **无** `fromSchema`/`importLegacy`/`convert`
- `applyBlueprint` 消费的是**简化的 V2 blueprint**（`public-types.ts:293-303`），不接受 Formily UISchema
- 唯一的 `uiSchemas` 访问是 V2 页面的**兼容壳写入**（`service.ts:28662-28682`，写 `{x-component:'FlowRoute'}`），不是 schema 内容转换

### 1.4 `flow-compat` 不是转换器
名字像兼容层，实际是工具/类型 shim（`flow-compat/index.ts:10-34`）——共享原语、路由类型枚举、lazy 加载、字段接口查找。**不渲染也不转换 `TableV2`。**

---

## 2. V2 无法原生渲染 V1 页面（关键）

`FlowRoute.tsx` 是核心闸门：
- `:37` — `LegacyPageBehavior = 'redirect' | 'notFound' | 'bridge'`
- `:198-225` — `<LegacyPageUnsupported>` 明确提示"这是 legacy 页面，请从原入口打开"
- `:379-388` — 路由类型 `page`（V1）：`notFound` → 404；`bridge` 仅在存在真实 FlowModel 时桥接
- `:452-454` — 渲染不支持提示

`resolveAdminRouteRuntimeTarget.ts:250-255` — V2 运行时下 V1 `page` 返回 `unsupportedV2Runtime`；`:159-173` — V1 路由在 `/v/` 菜单中隐藏。

`AdminLayoutEntryGuard.tsx:113-133` — 直接导航到 V1 页面会被重定向回原入口。

**"bridge" 不是向后兼容渲染器**——它是页面**迁移后**的样子（已有 FlowModel），不是把 Formily schema 渲染出来。

---

## 3. 存储层差异（转换的本质）

| | V1 | V2 |
|---|---|---|
| 表 | `uiSchemas`（`x-uid` PK、`schema` JSON、magic 属性） | `flowModels`（`uid` PK、`options` JSON、`use`/`stepParams`/`subModels`） |
| 定义 | `plugin-ui-schema-storage/src/server/collections/uiSchemas.ts:14-42` | `plugin-flow-engine/src/server/collections/flowModels.ts:14-36` |
| 路由类型 | `desktopRoutes.type='page'` | `desktopRoutes.type='flowPage'` |
| 页面树 | 嵌套 `properties`/`x-uid`/`x-component`/`x-component-props`/`x-reactions` | `uid`/`use`/`props`/`stepParams`/`subModels` + flow 定义 |

**转换 = 把 Formily 组件树翻译成 FlowModel 树，并重建 ACL、联动、弹窗、字段绑定。**

---

## 4. 组件映射表（结构上有对应）

| V1 `x-component` | V2 `use` | blueprint block type | 备注 |
|---|---|---|---|
| `TableV2` | `TableBlockModel` | `table` | 1:1 区块级对应 |
| `FormV2`(新建) | `CreateFormModel` | `createForm` | V2 拆分新增/编辑 |
| `FormV2`(编辑) | `EditFormModel`/`QuickEditFormModel` | `editForm` | 通用 `form` 不支持创建 |
| `Details` | `DetailsBlockModel` | `details` | ✅ |
| filter `FormV2` | `FilterFormBlockModel` | `filterForm` | ✅ |
| `List`/`GridCard`/`Kanban`/`Calendar` | 对应 BlockModel | ✅ | ✅ |
| `ChartV2` | `ChartBlockModel` | `chart` | ✅ |
| `Markdown`/`Iframe`/`Comments`/`RecordHistory`/`ActionPanel`/`Tree`/`JSBlock` | 对应 BlockModel | ✅ | ✅ |
| `Map` | `MapBlockModel` | `map` | ⚠️ `createSupported: false` |

依据：`flow-surfaces/support-matrix.ts:46-273`、`blueprint/public-types.ts:229-246`。

**几乎都有区块级对应——但字段/动作/交互的保真度才是难点。**

---

## 5. 自建转换器的可行管线

1. 读取 V1 页面：`uiSchemas` + `desktopRoutes.type='page'` + 角色 ACL（`uiSchemas.ts:45-52`）
2. 遍历 schema 树，按 `x-component` 分类区块，抽取 collection/dataSource、列/字段、动作、筛选、排序、弹窗
3. 每页生成一个 V2 blueprint（`version:'1', mode:'create', navigation, page, tabs[]`）
4. `POST flowSurfaces:applyBlueprint`（或 `nb api flow-surfaces apply-blueprint`）——服务端编译成 FlowModel 树并创建 `flowPage` 路由
5. 用 `flowSurfaces:get`/`exportBlueprint` 验证，再下线 V1 页面/路由
6. 用 `replace` 模式 + 记录 V1 uid → 新 V2 uid，实现幂等重跑

---

## 6. 主要难点（为什么不是个小脚本）

1. **无 settings 映射**：`x-component-props`/`x-use-component-props` → V2 `stepParams.<flow>.<key>` 无文档且命名不同（`showIndex`→`showRowNumbers`、`dataScope.filter` 结构变化）
2. **交互无 1:1**：V1 `x-reactions`/`x-linkage-rules`/`x-dependencies` → V2 event flow / `setFieldValueRules`（`constants.ts:31-34,66-70`）；校验器 ~330KB 严格规则，聚合 `errors[]` 重试
3. **弹窗树**：V1 `Action.Container → Tabs → Grid → FormV2` 嵌套要重写为 V2 popup 模型/模板
4. **字段注册表不同**：V1 `x-component` → V2 `DisplayTextFieldModel`/`DisplayEnumFieldModel` 等，接口语义不同
5. **V1-only 插件**（23 个，`v1-stripping-feasibility.md:83-86`）无 V2 模型——用了这些插件的页面**无法转换**
6. **遗留规则迁移只在 V2 模型内部**（`legacyDefaultValueMigrationBase.ts:119-151`），是 FlowModel 创建后迁移，不是从 UISchema 转
7. **ACL/路由需重建**：`applyBlueprint` create 模式不改已有菜单组元数据
8. **校验限制**：blueprint 拒绝通用 `form`、限制 kanban 字段、要求 tree table 标题字段、不支持 `defaults.blocks`
9. **`/v/` 隐藏**：直到路由改成 `flowPage` 才可见

**架构约束**：`AGENTS.md:12` 规定 V2 不能 import V1——解析 Formily schema 必须在 V1/脚本侧，跨 API 边界输出 V2 blueprint。**转换器要做成独立工具，不能放 v2 client。**

---

## 7. 工作量估算

| 方案 | 范围 | 工作量 | 适用场景 |
|---|---|---|---|
| 骨架转换器 | 页面/tabs/区块/列/标题/collection 绑定 | **2–4 周** | 标准表格+表单页，无复杂交互 |
| 中等保真 | + 筛选/排序/基础动作/简单弹窗 | **1–2 月** | 多数常规业务页 |
| 高保真批量 | + 联动规则/复杂弹窗/JS/字段级控制/ACL/幂等回滚 | **2–4 月+** | 全量迁移，部分页面仍不可转 |
| 手工重建（推荐起步） | 用 `applyBlueprint` 半自动逐页重建 | 每页 0.5–2 天 | 按价值分批，最可控 |

---

## 8. 最终建议

1. **不要期待一键转换**——没有官方工具，自建高保真转换器是数月项目且无官方兼容保证
2. **按页面价值分批手工重建**——用 `flowSurfaces:applyBlueprint` 作为半自动写入端（这正是前面建测试页用的 API，已验证可用）
3. **先做简单标准页**——表格+表单的页面转换成功率最高；含 V1-only 插件/复杂联动的页面标记为"手工重写"或"保留 V1"
4. **接受双入口并存**——`APP_CLIENT_ENTRY_MODE=modern-default` 或 `legacy-default` 可让 V1/V2 页面共存（前面分析过），不必强求全量迁移
5. **若必须工具化**——从骨架转换器起步（2–4 周），输出 blueprint，用 `replace` 模式幂等；把无法自动转换的页面列入人工队列

---

### 证据索引
- `CHANGELOG.md:685-742`（v2.2.0 迁移建议，无工具）
- `packages/core/cli-v1/src/commands/index.js:17-47`（无 migrate 命令）
- `flow-surfaces/constants.ts:23-76`（50+ actions，无 convert）
- `flow-surfaces/blueprint/public-types.ts:229-303`（blueprint 格式）
- `FlowRoute.tsx:198-225,379-454`（不支持 V1 页面）
- `resolveAdminRouteRuntimeTarget.ts:159-173,241-255`（路由解析）
- `support-matrix.ts:46-273`（组件映射）
- `AGENTS.md:12`（单向导入约束）
