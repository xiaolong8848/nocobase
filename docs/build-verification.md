# 构建验证记录

> 日期：2026-11-24
> 目的：验证性能优化改动可被正确打包，为发布做准备

## 构建结果

| 项 | 结果 |
|---|---|
| 单包构建 `@nocobase/client-v2 --no-dts` | ✅ 成功（lib/index.js 1828 kB） |
| 全量 `yarn build` | ✅ 成功（323.28s，含 v2 bundle `dist/client/v`） |
| v2 主 bundle | `index-3a2dcb88.js` 2033 kB / `1739-c8bebcfa.js` 4962 kB |
| 表格所在 chunk | 已包含在 v2 bundle 中 |

## 关键经验：必须用全量构建

单包构建（`yarn build @nocobase/client-v2`）会因依赖链声明未生成而失败（`Cannot find module '@nocobase/sdk'`、`Property 'props' does not exist on TableBlockModel` 等连锁错误）。

**这些不是代码错误**——是 monorepo 依赖声明未构建。正确做法：

```bash
yarn build   # 全量构建，按依赖顺序生成所有包的 declarations + bundle
```

构建耗时约 5 分钟，产出 `packages/core/app/dist/client/v/` 完整 v2 前端。

## 发布启示

镜像构建时，官方 Dockerfile 用 `create-nocobase-app` 从 registry 拉包——不会用这里的 dist。所以发布路径仍是：

1. `yarn build` 验证改动可打包（已完成）
2. 发布改动的包到私有 verdaccio registry（`@nocobase/client-v2` 及其依赖）
3. 用官方 Dockerfile + `VERDACCIO_URL` + `BEFORE_PACK_NOCOBASE` 构建镜像

详见 `BUILD-AND-RELEASE-STRATEGY.md` 和 `END-TO-END-OPERATIONS-MANUAL.md`。

## 当前分支状态

改动已提交到 `perf/table-block-refactor`：
- `9e84a60cb3` docs: verify linkage safety
- `e0f7572e6c` docs: functional verification
- `9024189761` perf(client-v2): shouldCellUpdate (-78%)
- 更早：基线、负面结果、18 篇分析文档

全量构建通过 = 改动可进入发布流程。
