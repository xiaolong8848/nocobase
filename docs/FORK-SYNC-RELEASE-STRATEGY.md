# Fork、同步官方、镜像发布 — 完整架构决策

> 日期：2026-11-24
> 三个核心问题：① 是否需要 fork 官方仓库？② 是否只能用自己发布的镜像？③ 能否同步官方改动？

---

## 0. 结论速览

| 问题 | 答案 |
|---|---|
| 是否需要 fork 官方仓库？ | **强烈建议 fork**（本地仓库不够：无远端备份、无法规范化同步、无法协作） |
| 改动后是否只能用自己发布的镜像？ | **核心改动是的**；但若改动做成插件，可继续用官方镜像 + 插件包 |
| 能否同步官方改动？ | **能**，通过 `upstream` remote + 定期 merge/rebase，这是 fork 的标准工作流 |

---

## 1. 是否需要 fork 官方仓库

### 1.1 当前状态
`/Users/xiaolong/nocobase-v2.2.51` 是 `git clone --depth 1` 的**浅克隆**：
- `origin` 指向官方 `https://github.com/nocobase/nocobase.git`
- 我建的 `perf/table-block-refactor` 分支只在本地
- **浅克隆没有完整历史，无法可靠 merge 官方更新**

### 1.2 为什么必须 fork

| 理由 | 说明 |
|---|---|
| **远端备份** | 本地分支丢失风险；fork 后代码在云端 |
| **同步官方** | fork 有标准的 `upstream` 同步流程；纯本地 clone 同步困难 |
| **权限与协作** | 你自己的仓库可控制分支保护、PR、tag |
| **发布溯源** | 镜像里 `COMMIT_HASH` 可指向你的 fork commit，可追溯 |
| **多环境一致性** | 开发机、构建机、CI 都从你的 fork 拉代码 |

### 1.3 推荐做法

```
1. GitHub 上 fork nocobase/nocobase → github.com/<you>/nocobase
2. 本地新目录（不在 noco-v2 下）：
   git clone https://github.com/<you>/nocobase.git
   cd nocobase
   git remote add upstream https://github.com/nocobase/nocobase.git
   git checkout -b perf/table-block-refactor v2.2.51   # 或基于你实际用的版本
3. 把 16 篇文档 + 代码改动迁过来
```

注意：你的 `noco-v2/source` 是 **v2.2.30**，而分析基于 **v2.2.51**。fork 时**必须统一基线版本**——建议以你实际部署的版本为准（v2.2.30 或 v2.2.51）。

---

## 2. 改动后是否只能用自己发布的镜像

### 2.1 取决于改动落在哪一层

| 改动层 | 分发方式 | 是否必须用自建镜像 |
|---|---|---|
| **核心 `@nocobase/client-v2`**（Phase 1–2 的 props 稳定、fork 治理） | 私有 npm registry + 自建镜像 | **是** — 官方镜像拉的是已发布包，不含你的改动 |
| **插件层**（Phase 3 共存块、你的 dgcross 插件） | 插件 tar 导入 | **否** — 可继续用官方镜像 + `nb plugin import` |
| **纯配置** | 数据库配置 | 否 |

### 2.2 关键结论

- 只要你改了 `packages/core/client-v2/src/...` 的源码 → **必须自建镜像**（前面 `BUILD-AND-RELEASE-STRATEGY.md` 详述）
- "自建镜像"不等于"从零维护产品"——你仍基于官方代码，只是多了你的改动 commit，用私有 registry 托管改过的包
- 如果为了长期少维护镜像，可以考虑把优化尽量做成**插件**（但 Phase 1–2 的核心改动做不到，前面已论证）

### 2.3 混合策略（推荐）

```
核心改动（Phase 1-2）→ 自建镜像（私有 registry）
插件改动（Phase 3 + dgcross 插件）→ 插件 tar，跟随镜像内置或部署时导入
```

---

## 3. 能否同步官方改动

### 3.1 能，这是 fork 的标准工作流

```bash
# 添加官方为 upstream（一次性）
git remote add upstream https://github.com/nocobase/nocobase.git

# 定期同步（推荐 merge，保留你的分支历史）
git fetch upstream
git checkout perf/table-block-refactor
git merge upstream/main        # 或 upstream/v2.2.x 对应分支

# 解决冲突 → 测试 → 推送到你的 fork
git push origin perf/table-block-refactor
```

### 3.2 两种同步策略对比

| 策略 | 命令 | 优点 | 缺点 |
|---|---|---|---|
| **merge**（推荐） | `git merge upstream/main` | 保留历史、冲突集中、可追溯 | 历史有 merge commit |
| **rebase** | `git rebase upstream/main` | 线性历史 | 你的 commit hash 全变（镜像溯源失效），冲突逐个解 |

**推荐 merge**——因为你的镜像用 COMMIT_HASH 溯源，rebase 会让 hash 变化。

### 3.3 降低同步冲突的关键

前面所有方案都强调"改动集中、契约不变"，这正是为了同步：
- Phase 1–2 只改 3 个文件的少数函数 → 官方在这些文件的改动大概率不冲突
- 不改 schema key / flow step keys / 类身份 → 官方重构这些时你的改动也不受影响
- 每 Phase 独立 commit → 冲突时可单独定位

### 3.4 版本升级流程

```
官方发新版本（如 v2.3.0）
  ↓
git fetch upstream && git merge upstream/main
  ↓
冲突只在你的 3 个改动文件 → 手动解决
  ↓
跑表格单测 + e2e
  ↓
重新构建私有 registry 包 + 自建镜像
  ↓
新 COMMIT_HASH 的镜像部署
```

---

## 4. 推荐的整体工作流

```
github.com/<you>/nocobase (fork)
  ├── upstream → 官方（定期 fetch + merge 同步）
  └── perf/table-block-refactor 分支
        ├── 16 篇文档（校准到实际版本）
        ├── Phase 1-2 核心改动 → 私有 registry → 自建镜像
        └── 插件改动 → dgcross 插件仓库 → 插件 tar

部署：
  noco-test-v2 容器 ← 换成你的自建镜像 ← 私有 registry（含改动包）
                     ← 插件 tar 导入（插件层改动）
```

---

## 5. 一句话回答

**Q1：是否需要 fork 官方仓库到自己的 GitHub？**
**A：强烈建议。本地 clone（尤其浅克隆）无法可靠同步官方更新，fork 提供远端备份、标准 upstream 同步流程、权限与溯源。**

**Q2：改动后是否只能用自己发布的镜像？**
**A：核心 client-v2 改动是的（官方镜像不含你的源码）；插件层改动否（可用官方镜像 + 插件 tar）。推荐混合策略。**

**Q3：能否同步官方改动？**
**A：能。fork + upstream remote + 定期 merge（推荐）或 rebase，冲突因"改动集中、契约不变"而可控。每次同步后重新构建镜像即可。**
