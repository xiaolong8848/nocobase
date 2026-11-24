# NocoBase 表格优化：从 Fork 到发布的完整操作手册

> 日期：2026-11-24
> 适用：v2 表格性能优化（Phase 1–2 核心改动 + 可选插件改动）
> 前置：本地有 Docker、Node 22、Yarn 1.22、Git

---

## 总览：7 个阶段

```
1. Fork 官方仓库 → 自己的 GitHub
2. 本地建开发环境（全新目录，非 noco-v2）
3. 配置 upstream（同步官方）
4. 迁移文档 + 校准版本
5. 本地开发（dev 模式 + pg16 测试）
6. 构建 + 发布私有包（verdaccio）
7. 构建镜像 + 部署替换
```

---

## 阶段 1：Fork 官方仓库

### 1.1 GitHub 上 fork
- 打开 https://github.com/nocobase/nocobase
- 点右上角 **Fork** → 选你自己的账号
- 得到 `https://github.com/<你的用户名>/nocobase`

### 1.2 确认基线版本
你的实际部署是 **v2.2.30**（noco-v2/source）还是 **v2.2.51**（我分析的分支）？
- 建议以**实际部署版本**为准，避免行号/API 差异
- 若不确定，用 `v2.2.51`（本手册以此为例）

---

## 阶段 2：本地建开发环境（全新目录）

```bash
# 不在 noco-v2 下，新建独立目录
cd /Users/xiaolong
git clone https://github.com/<你的用户名>/nocobase.git nocobase-perf
cd nocobase-perf

# 基于目标版本建分支
git checkout -b perf/table-block-refactor v2.2.51

# 确认版本
grep -m1 '"version"' lerna.json   # 应为 2.2.51
```

---

## 阶段 3：配置 upstream（同步官方）

```bash
cd /Users/xiaolong/nocobase-perf

# 添加官方为 upstream（一次性）
git remote add upstream https://github.com/nocobase/nocobase.git

# 验证
git remote -v
# origin   → 你的 fork（可 push）
# upstream → 官方（只 fetch）

# 日常同步命令（每周/官方发版时）
git fetch upstream
git checkout perf/table-block-refactor
git merge upstream/main        # 用 merge，不用 rebase（保 hash 溯源）
# 解决冲突 → 测试 → 推送
git push origin perf/table-block-refactor
```

---

## 阶段 4：迁移文档 + 校准版本

```bash
# 从旧分析目录拷入 17 篇文档
cp /Users/xiaolong/nocobase-v2.2.51/docs/*.md /Users/xiaolong/nocobase-perf/docs/

# 若基线是 v2.2.30，需重新核对行号（表格核心文件基本对应）
# 文档头部标注基线版本
```

---

## 阶段 5：本地开发（dev 模式 + pg16 测试）

### 5.1 安装依赖
```bash
cd /Users/xiaolong/nocobase-perf
yarn install --frozen-lockfile    # monorepo 依赖，约 10 分钟
```

### 5.2 配置数据库（用你本地的 pg16 容器）

当前 pg16：`postgres:16-dgcross`，端口 `54316`，密码 `Ruman801220`。

**新建一个独立测试库**（不碰 noco_v2 现有数据）：
```bash
docker exec -it postgres16 psql -U postgres -c "CREATE DATABASE nocobase_perf_test;"
```

修改 `.env`（复制 example）：
```bash
cp .env.example .env
# 编辑 .env：
APP_PORT=13001              # 避免和 noco-test-v2 的 13000 冲突
DB_DIALECT=postgres
DB_HOST=host.docker.internal
DB_PORT=54316
DB_DATABASE=nocobase_perf_test
DB_USER=postgres
DB_PASSWORD=Ruman801220
APP_KEY=test-key-perf
```

### 5.3 初始化应用
```bash
yarn nocobase install --lang=zh-CN
```

### 5.4 启动 dev 模式
```bash
yarn dev
# 只跑 v2：yarn dev:client-v2
# 打开 http://localhost:13001
```

### 5.5 开发迭代
- 改 `packages/core/client-v2/src/flow/models/blocks/table/` 下的表格代码
- dev 模式热更新，直接刷新 13001 看效果
- 跑测试：
```bash
yarn tc packages/core/client-v2/src/flow/models/blocks/table
yarn eslint --fix <touched files>
```

### 5.6 建立性能基线（改代码前先测）
参考 `V2-TABLE-PERFORMANCE-IMPROVEMENT-PLAN.md` 的 Phase 0：
- 构造 200 行 × 10 列测试表
- 用 React Profiler 记录首屏/勾选/翻页耗时、DOM 节点数、forkCache 大小
- 记录到 `docs/perf-baseline.md`

---

## 阶段 6：构建 + 发布私有 npm 包（verdaccio）

> 核心 client-v2 改动必须走这条；插件改动可跳过到阶段 6B

### 6.1 启动 verdaccio
```bash
# 用官方 docker-compose 里的 verdaccio（端口 10104）
docker compose up -d verdaccio
# 或独立启动
docker run -d --name verdaccio -p 4873:4873 verdaccio/verdaccio
```

验证 uplink（能否拉官方包）：
```bash
npm view react version --registry http://localhost:4873
# 应返回官方版本号 → uplink 正常
```

### 6.2 登录 verdaccio
```bash
npm login --registry http://localhost:4873 --auth-type=legacy
# 默认可注册 test/test/test@nocobase.com（官方 Dockerfile 用的就是这个）
```

### 6.3 构建 monorepo
```bash
cd /Users/xiaolong/nocobase-perf
yarn build
# 或只构建 client-v2：yarn build @nocobase/client-v2
```

### 6.4 发布改动包到私有 registry
```bash
# 给改动包打私有版本（避免和官方冲突）
# 方法 A：lerna 批量发布（参考 package.json release:force）
yarn lerna publish from-package --yes --registry http://localhost:4873

# 方法 B：单独发布核心包
cd packages/core/client-v2
npm publish --registry http://localhost:4873 --tag perf
```

⚠️ **版本陷阱**：CNA 内部固定依赖版本（如 `@nocobase/client-v2@2.2.51`）。你必须确保：
- 发布的私有包版本号与 CNA 期望的**一致**，或
- 通过镜像构建时的 `BEFORE_PACK_NOCOBASE="yarn add @nocobase/client-v2@<你的版本>"` 强制覆盖

### 6B：插件改动（如果只做插件）

```bash
cd dgcross-noco-plugin/plugin-xxx
yarn build --tar
# 产物：storage/tar/<plugin>-<version>.tgz
# 导入运行中的应用：
docker cp xxx.tgz noco-test-v2:/tmp/
docker exec noco-test-v2 nb plugin import /tmp/xxx.tgz
```

---

## 阶段 7：构建镜像 + 部署替换

### 7.1 构建自建镜像

用官方根 `Dockerfile`（支持 VERDACCIO_URL 参数）：

```bash
cd /Users/xiaolong/nocobase-perf

docker build \
  -f Dockerfile \
  --build-arg VERDACCIO_URL=http://host.docker.internal:4873/ \
  --build-arg CNA_VERSION=2.2.51 \
  --build-arg COMMIT_HASH=$(git rev-parse HEAD) \
  --build-arg BEFORE_PACK_NOCOBASE="yarn add @nocobase/client-v2@<你的私有版本> -W --production" \
  -t your-registry/nocobase-perf:2.2.51-perf.1 \
  .

docker push your-registry/nocobase-perf:2.2.51-perf.1
```

> 若需双架构：`docker buildx build --platform linux/amd64,linux/arm64 ...`（参考 `.github/workflows/build-docker.yml`）

### 7.2 部署替换 noco-test-v2

修改 docker-compose（或新建）：
```yaml
services:
  app:
    image: your-registry/nocobase-perf:2.2.51-perf.1
    # 环境变量保持原 noco-test-v2 的 DB 配置（指向 pg16:54316）
    environment:
      - DB_HOST=host.docker.internal
      - DB_PORT=54316
      - DB_DATABASE=noco_v2
      - DB_USER=postgres
      - DB_PASSWORD=Ruman801220
      - APP_KEY=your-secret-key
    ports:
      - "13000:80"
```

```bash
docker compose down noco-test-v2
docker compose up -d app
```

### 7.3 验证
- 打开 http://localhost:13000，确认页面正常
- 构造 226 行 × 32 字段表，对照 `perf-baseline.md` 验证收益
- 检查 ACL、联动、text-copy 等未回归

---

## 官方同步的完整循环（日常维护）

```bash
# 官方发新版本时
cd /Users/xiaolong/nocobase-perf
git fetch upstream
git merge upstream/main
# 冲突只会在你改的 3 个表格文件 → 手动解决
yarn tc packages/core/client-v2/src/flow/models/blocks/table
git push origin perf/table-block-refactor
# → 回到阶段 6-7 重新构建镜像
```

---

## 关键风险与注意

| 风险 | 缓解 |
|---|---|
| 版本陷阱：CNA 拉官方包而非你的改动包 | 用 `BEFORE_PACK_NOCOBASE` 强制 `yarn add` 你的私有版本；验证镜像内代码含改动 |
| 端口冲突 13000 | dev 用 13001，部署前先停 noco-test-v2 |
| DB 数据丢失 | 用独立库 `nocobase_perf_test`，不碰 `noco_v2` |
| 浅克隆无法同步 | 阶段 2 用完整 clone，加 upstream |
| rebase 破坏 hash 溯源 | 用 merge 不用 rebase |

---

## 命令速查表

| 阶段 | 关键命令 |
|---|---|
| Fork | GitHub Fork + `git clone <your-fork>` |
| upstream | `git remote add upstream https://github.com/nocobase/nocobase.git` |
| 开发 | `yarn install && yarn dev` (端口 13001) |
| 测试 | `yarn tc packages/core/client-v2/src/flow/models/blocks/table` |
| 构建 | `yarn build` |
| 发布私有包 | `npm publish --registry http://localhost:4873` |
| 构建镜像 | `docker build --build-arg VERDACCIO_URL=... -t ...` |
| 部署 | `docker compose up -d` |
| 同步官方 | `git fetch upstream && git merge upstream/main` |
