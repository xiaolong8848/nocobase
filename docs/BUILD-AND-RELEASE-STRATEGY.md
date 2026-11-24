# 优化后的发布与 Docker 镜像打包方案

> 分支：`perf/table-block-refactor`　|　日期：2026-11-24
> 核心问题：优化代码在自己分支管理，如何构建镜像发布

---

## 0. 结论先行

**是的，在你自己的分支单独管理，并且必须自己构建镜像。** 官方镜像不能直接用——因为它不是从源码构建的。

关键发现（已核查源码）：

| 事实 | 证据 |
|---|---|
| 官方 Dockerfile 用 `create-nocobase-app` 从 **npm registry 拉包**构建，不读本地源码 | `Dockerfile:28-31`、`docker/nocobase/Dockerfile:8-11` |
| build-docker 工作流传 `CNA_VERSION=<tag>`，即"用哪个已发布版本建镜像" | `.github/workflows/build-docker.yml:36-44` |
| 官方明确"不建议从源码做生产部署" | `git.mdx` Step 6 |
| 源码改动进入镜像的唯一方式：**发布 npm 包 → 让 CNA 拉到你改的包**，或**自建镜像** | 见下文 |

---

## 1. 为什么官方镜像"装不上"你的改动

```
官方 Dockerfile 流程：
  npx create-nocobase-app → yarn install --production → 从 registry 拉 @nocobase/* 已发布包
                                              ↑
                                    这里拉的是官方 npm 包，不是你的分支代码
```

你的表格优化在 `packages/core/client-v2/src/...`。官方镜像里这段来自 `@nocobase/client-v2` 的**已发布 npm 包**，你的源码改动根本不会被包含。

---

## 2. 三条发布路径（按推荐度排序）

### 路径 A：自建 Docker 镜像（推荐，最直接）

把你的分支源码做成镜像。两种子方式：

**A1. 从源码构建（改动在核心 client-v2，必须走这条）**

由于你的优化改的是**核心包** `@nocobase/client-v2`，不是独立插件，不能用插件 tar 包方式。需要：

```bash
# 1. 在自己的分支构建 monorepo
cd /Users/xiaolong/nocobase-v2.2.51
git checkout perf/table-block-refactor
yarn install --frozen-lockfile
yarn build          # 构建所有包，产出 es/ 和 lib/

# 2. 把构建产物发布到私有 npm registry（如 verdaccio）
#    因为 CNA 是从 registry 拉包的
npx verdaccio &     # 或用已有 verdaccio
# 配置 npm/yarn registry 指向私有库
yarn config set registry http://<your-verdaccio>:4873
# 发布改动过的包（含 @nocobase/client-v2 及其依赖链）
yarn lerna publish from-package --yes --registry http://<your-verdaccio>:4873

# 3. 用私有 registry 构建镜像
docker build \
  -f docker/nocobase/Dockerfile \
  --build-arg CNA_VERSION=<你的版本> \
  --build-arg VERDACCIO_URL=http://<your-verdaccio>:4873 \
  -t nocobase-custom:<tag> .
```

说明：官方根 `Dockerfile` 恰好支持 `VERDACCIO_URL` 和 `APPEND_PRESET_LOCAL_PLUGINS` 参数（`:4-7`），其 app-builder 阶段用 `expect` 登录私有库并从该库 `yarn create nocobase-app`（`:17-30`）。CI 里的 pro 镜像也是这个套路（`BEFORE_PACK_NOCOBASE="yarn add ..."`）。

**A2. 修改 Dockerfile 直接 COPY 本地构建产物（备选）**

如果不想维护私有 registry，可写一个自定义 Dockerfile，跳过 `create-nocobase-app` 拉包阶段，直接把本地 `yarn build` 的产物 COPY 进镜像。这需要改 Dockerfile，但更可控。

### 路径 B：把它做成独立插件（如果优化能收敛到插件层）

如果 Phase 3 的"静态快路径"做成共存块 `FastTableBlockModel`，那它就是独立插件，可以用 NocoBase 标准插件分发：

```bash
yarn build @nocobase/plugin-fast-table-block --tar
# 产物 storage/tar/@nocobase/plugin-fast-table-block-<version>.tgz
```

部署到目标应用：
```bash
nb plugin import plugin-fast-table-block-0.1.0.tgz
# 或放到 storage/plugins/ 目录
```

镜像里预装：`APPEND_PRESET_LOCAL_PLUGINS=@nocobase/plugin-fast-table-block`（写入 .env，或 `BEFORE_PACK_NOCOBASE`）。

**注意**：Phase 1–2 的核心改动（props 稳定、fork 治理）改的是 `client-v2` 核心，无法用插件 tar 分发——只能走路径 A。

### 路径 C：源码直接部署（仅开发/测试，官方不推荐生产）

```bash
git clone <your-fork> -b perf/table-block-refactor --depth=1
yarn install --frozen-lockfile
yarn build
yarn start
```
适合验证，不适合生产（官方明确说明）。

---

## 3. 推荐组合策略

| 改动阶段 | 所在层 | 分发方式 |
|---|---|---|
| Phase 1（props 稳定） | 核心 client-v2 | 路径 A（自建镜像，私有 registry） |
| Phase 2（fork 治理） | 核心 flow-engine/client-v2 | 路径 A |
| Phase 3（静态快路径） | 可做成插件 | 路径 B（插件 tar，如果收敛为共存块） |
| Phase 4（虚拟） | 核心/插件 | 视实现层定 |

**因此你需要具备私有 npm registry + 自建镜像的能力**（路径 A）。这是核心改动分发的必要条件。

---

## 4. 分支管理策略

### 4.1 是的，在你自己的分支单独管理

```
fork: github.com/<you>/nocobase
branch: perf/table-block-refactor  (基于 v2.2.51 tag)
```

已经做到：分支已建，改动以独立 commit 提交，文档齐全。

### 4.2 长期维护建议

1. **保持改动最小、集中**：Phase 1–2 只改 3 个文件的少数函数，便于上游升级时 rebase
2. **每个 Phase 独立 commit**：可单独 revert，出问题快速回退
3. **跟随上游升级**：定期把 fork 的 `main`/`next` 合并进来，解决冲突
4. **版本标记**：给 fork 打自己的 tag，如 `v2.2.51-perf.1`

### 4.3 私有 registry 选项
- **verdaccio**（官方 docker-compose 已含此服务，`docker-compose.yml:5-11`）— 轻量，自托管
- 阿里云/腾讯云 npm 私有仓库
- GitHub Packages / GitLab Registry

---

## 5. 完整发布流程（路径 A 详细步骤）

```bash
# ── 开发机上 ──
cd /Users/xiaolong/nocobase-v2.2.51
git checkout perf/table-block-refactor

# 构建
yarn install --frozen-lockfile
yarn build

# 发布到私有 registry（含改动包）
npm config set registry http://<verdaccio>:4873
yarn lerna publish from-package --yes --registry http://<verdaccio>:4873
# 给从 @nocobase/client-v2 到入口的所有依赖链打上你的版本号

# ── 构建机 / CI ──
cat > .env <<EOF
VERDACCIO_URL=http://<verdaccio>:4873
CNA_VERSION=<你的版本号>
EOF

docker build \
  -f Dockerfile \
  --build-arg VERDACCIO_URL=http://<verdaccio>:4873 \
  --build-arg CNA_VERSION=<你的版本号> \
  --build-arg COMMIT_HASH=$(git rev-parse HEAD) \
  -t your-registry/nocobase-perf:<tag> .

docker push your-registry/nocobase-perf:<tag>

# ── 部署 ──
# docker-compose.yml 里把 image 改成你的镜像
image: your-registry/nocobase-perf:<tag>
docker compose up -d
```

---

## 6. 关键风险

| 风险 | 缓解 |
|---|---|
| 私有 registry 构建时 `create-nocobase-app` 拉不到私有版本 | 确保 CNA 版本与发布包版本一致；CI 里 pro 镜像用 `BEFORE_PACK_NOCOBASE` 显式 `yarn add` 指定包 |
| 依赖链版本漂移 | 用 frozen lockfile + 固定版本号 |
| 上游升级后 fork rebase 冲突 | 改动集中、每 Phase 独立 commit |
| 双架构镜像（amd64/arm64） | 用 buildx（参考 `.github/workflows/build-docker.yml:22-44`） |

---

## 7. 一句话回答

**Q：优化后如何发布和打包 Docker 镜像，是在自己分支单独管理吗？**

**A：是的，在你自己的分支单独管理。但官方 Docker 镜像从 npm registry 拉包构建、不含你的源码改动，所以你必须自建镜像：用私有 npm registry（如 verdaccio）托管你改过的 `@nocobase/client-v2` 等包，再用官方 Dockerfile 的 `VERDACCIO_URL` 参数构建你自己的镜像。核心改动（Phase 1–2）无法用插件 tar 分发，私有 registry + 自建镜像是必要条件；若 Phase 3 收敛为共存插件，那部分可用标准插件 tar 分发。**
