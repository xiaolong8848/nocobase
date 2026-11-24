# 剥离 v1 代码的可行性分析（v2-only 分支）

> 分支：`perf/table-block-refactor`　|　日期：2026-11-24
> 结论基于全仓库源码审计（v2 对 v1 的 import、插件运行时分布、构建系统、服务端契约）

---

## 0. 结论先行

**技术上可以剥离，但「剥离」有三个不同层次，收益与代价差异很大：**

| 层次 | 含义 | 可行性 | 代价 |
|---|---|---|---|
| ① 运行时不加载 v1 | `APP_CLIENT_ENTRY_MODE=modern-only` | ✅ **官方已支持**（零改动） | 生产构建仍打包 v1（体积未省） |
| ② 构建产物排除 v1 | 改 `build` 配置使生产只产 v2 bundle | ⚠️ **需改构建代码**（当前无此开关） | 1–2 周，需自维护构建补丁 |
| ③ 源码级删除 v1 | 删 `client/`、`src/client/` 等目录 | ✅ **依赖上可行** | 23 个 v1-only 插件失效 + 28 个 v2 测试断裂 + 生产入口 handoff 需重写 |

**最关键的发现：依赖是严格单向的（v1 → v2），v2 生产代码对 v1 的 import 为零。** 这意味着删除 v1 不会破坏 v2 运行时——这也是剥离可行的根本原因。

---

## 1. 为什么可以剥离：单向依赖已验证

审计范围：`packages/core/client-v2/src`、`packages/core/flow-engine/src`、全部插件 `src/client-v2/`、`packages/presets/nocobase/src/client-v2/`。

| 检查 | 结果 |
|---|---|
| v2 生产代码 import `@nocobase/client`（v1） | **0 处** |
| v2 生产代码相对路径 import v1 源码 | **0 处** |
| 插件 `src/client-v2/` import v1 | **0 处** |
| flow-engine 对 v1 的依赖 | **0**（`flow-engine/package.json:8-25` 无 `@nocobase/client`） |
| v2 清单声明 `@nocobase/client` 依赖 | **无**（`client-v2/package.json:21-51`） |
| 反向：v1 import/re-export v2 | **有，且很多**（`client/src/index.ts:25-101` 约 76 个符号，含 `TableBlockModel:83`；core client 50 个文件） |

**结论**：删 v2 会破坏 v1；删 v1 **不会**破坏 v2。依赖方向完全支持剥离。

**唯一例外（仅测试）**：28 个 v2 测试文件 import v1 做 parity 对照，例如 `TableBlockModel.dragSort.test.ts:12`、`plugin-ui-templates/.../v1Compatibility.test.tsx:106`。删除 v1 后这些测试需删除或改写（运行时不受影响）。

---

## 2. 层次 ①：运行时不加载 v1（已官方支持，零改动）

`APP_CLIENT_ENTRY_MODE` 三态（`cli-v1/src/util.js:435-457`）：`legacy-default` / `modern-default` / `modern-only`。

- `modern-only`：dev 时 `shouldRunClient=false`，只跑 v2（`dev.js:51-59,184-187`）
- v2 rsbuild 在 modern-only 下注册 dev middleware，把非 `/v/` 文档请求 302 到现代入口（`client-v2/rsbuild.config.ts:307-341`）
- v2 入口已独立构建到 `dist/client/v`（`rsbuild.config.ts:28,227-237`），服务端 `gateway/index.ts:540-574` 直接从该目录服务

**⚠️ 重要陷阱**：生产环境中 `modern-only` 的 URL 跳转 handoff 实现在 **v1 的 shell** 里（`app/client/public/browser-checker.js:68-88`），由 gateway 在非 v2 请求时回退到 legacy `index.html`（`gateway/index.ts:582-587`）。**如果直接删除 v1 shell，生产的 `modern-only` 跳转机制会消失。**

---

## 3. 层次 ②：构建产物排除 v1（需改构建代码）

**现状：生产构建无条件构建两套 shell 和两个 client 库。**

- `build.js:19-29` 的选项：**没有** `--client-v2-only`（`-v/-c/-r/-w/-s/--no-dts`）
- `package.json:27` 的 `build:client-v2 = nocobase-v1 build --client-v2-only` —— 该 flag 被 `.allowUnknownOption()`（`build.js:21`）**静默吞掉**，实际无效
- `build.ts:100-113` 无条件构建 core client-v2 **和** core client
- `build.ts:144-162` 无条件跑两个 rsbuild：`client/rsbuild.config.ts` 与 `client-v2/rsbuild.config.ts`

**要做 v2-only 生产构建，必须**：
1. 给 build CLI 增加真实选项或修改 `build.ts` 跳过 v1 两处构建
2. 把 `browser-checker.js` 的 handoff 逻辑移植到 v2 shell（或让服务端直接处理 legacy 路径重写）
3. 处理 `gateway/index.ts:582-587` 的 legacy index 回退

工作量估计 **1–2 周**，属于自维护构建补丁。收益：生产 bundle 不再含 v1 代码（体积减小、构建时间缩短）。

---

## 4. 层次 ③：源码级删除 v1（依赖可行，但有功能代价）

### 4.1 插件运行时分布（110 个插件）

| 分类 | 数量 |
|---|---|
| 有 `src/client/`（v1） | **110 / 110** |
| 有 `src/client-v2/`（v2） | **87 / 110** |
| 双运行时（BOTH） | **87** |
| **仅 v1** | **23** |
| 仅 v2 | 0 |

23 个 v1-only 插件（删除其 `src/client/` = 整个客户端实现消失）：
`audit-logs`、`backup-restore`、`block-multi-step-form`、`block-template`、`charts`、`custom-variables`、`data-source-main`、`disable-pm-add`、`error-handler`、`flow-engine`(v1 client 部分)、`graph-collection-manager`、`hello`、`mcp-server`、`mobile`、`mobile-client`、`mock-collections`、`multi-app-manager`、`multi-app-share-collection`、`notifications`、`snapshot-field`、`system-settings`、`ui-schema-storage`、`workflow-test`

**注意**：这些插件在 `/v/` 下本来就不加载（`devtools/common.js:153-159,201-207` 的 `generateV2Plugins()` 过滤）。所以删除它们**不影响 v2 页面**——它们本来就没有 v2 实现。

### 4.2 服务端 flow-engine：完全无影响

`plugin-flow-engine/src/server/flow-surfaces/index.ts:10-24` 只 import `@nocobase/resourcer`/`@nocobase/server` 和本地模块，无 v1/v2 client 依赖。所有 `src/server/` 中只有 `plugin-client/src/server/cron.ts` import v1（且 plugin-client 是 v1-only）。

### 4.3 删除 v1 后必须保留/处理的

| 项 | 处理 |
|---|---|
| 28 个 v2 compat 测试 | 删除或改写（仅测试） |
| 生产 handoff `browser-checker.js` | 必须移植到 v2 shell 或服务端 |
| `client/src/index.ts:25-101` 的 v1→v2 re-export | 随 v1 一起消失，安全 |
| v1 shell、v1 preset、`plugin-client` | 一并删除 |
| `gateway/index.ts:582-587` legacy fallback | 需调整 |
| 共享底层包（sdk/shared/utils/evaluators/flow-engine） | 保留，均不依赖 v1 |

---

## 5. 对「表格区块重写」项目的实际意义

**如果目标是只优化 v2 表格、不关心 v1：你不需要真的删除 v1 源码。**

推荐路径（风险最低）：

1. **立刻可用**：设 `APP_CLIENT_ENTRY_MODE=modern-only`，运行时不再加载 v1（零代码改动）
2. **表格优化**：在 `client-v2` / 插件内做（已在前报详述），与 v1 完全隔离
3. **可选清理**：若要减小构建产物，改 `build.ts` 跳过 v1 构建 + 移植 handoff；若要彻底删除 v1 源码，需接受 23 插件客户端消失 + 28 测试改写

**不建议为了表格性能优化而删除 v1 源码**——两者没有技术耦合，v1 的存在不消耗 v2 运行时性能，只影响构建体积和维护负担。删除源码是一笔独立的、收益有限但副作用明确的账。

---

## 6. 最终答案

**Q：是否可剥离 v1 相关代码？**

**A：可以，但要区分层次：**
- **运行时隔离**：已官方支持（`modern-only`），立即可用，零成本
- **构建产物排除**：可行，但需改构建系统并移植入口 handoff（1–2 周）
- **源码删除**：依赖上完全可行（v2 对 v1 零 import），但会导致 23 个 v1-only 插件客户端消失、28 个 v2 测试断裂，且需重写生产入口跳转

**对本项目（v2 表格性能优化）的建议**：直接用 `modern-only` 做运行时隔离即可，表格优化代码与 v1 完全解耦，**无需删除 v1 源码**。把精力放在表格渲染本身，而不是剥离旧运行时。
