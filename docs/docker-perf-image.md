# 本地 Docker 镜像与表格优化验证

> 日期：2026-11-25
> 分支：`perf/table-block-refactor`

## 镜像

- 镜像：`nocobase-perf:v2-optimized`（11.2 GB）
- Dockerfile：`docker/nocobase/Dockerfile-perf-local`
- 入口：`docker/nocobase/docker-entrypoint-perf.sh`
- 与官方 Dockerfile 的区别：不从 npm 拉取发行版，而是把当前 fork 的源码 + 已构建的
  `lib`/`es`/`dist` 复制进镜像，并在 Linux 容器内重新安装依赖（避免 macOS 原生二进制不可用）。
- 构建时临时用一份不含 `node_modules` 与 `.git` 的 `.dockerignore`，构建后已恢复原文件。

```bash
# 构建
cp .dockerignore /tmp/dockerignore.perf.backup
cat > .dockerignore <<'EOF'
.git
.github
**/node_modules
**/.umi
**/.umi-production
storage/logs
storage/db
storage/app-dev
*.log
.DS_Store
.vscode
.idea
*.sqlite
/uploads
EOF
docker build -f docker/nocobase/Dockerfile-perf-local -t nocobase-perf:v2-optimized .
cp /tmp/dockerignore.perf.backup .dockerignore
```

## 数据库

从已有的 `nocobase_perf_test` 导出并导入到独立库 `nocobase_perf_docker`（postgres16 容器）：

```bash
docker exec postgres16 pg_dump -U postgres nocobase_perf_test > /tmp/perf_seed.sql
docker exec postgres16 psql -U postgres -c "DROP DATABASE IF EXISTS nocobase_perf_docker;" \
  -c "CREATE DATABASE nocobase_perf_docker;"
docker exec -i postgres16 psql -U postgres nocobase_perf_docker < /tmp/perf_seed.sql
# perf_table: 4998 行
```

## 容器

```bash
docker run -d --name nocobase-perf-v2 --network nocobase -p 13011:80 \
  -e APP_ENV=production -e APP_PORT=80 -e APP_KEY=perf-test-key-2026 \
  -e DB_DIALECT=postgres -e DB_HOST=postgres16 -e DB_PORT=5432 \
  -e DB_DATABASE=nocobase_perf_docker -e DB_USER=postgres -e DB_PASSWORD=<password> \
  -e TZ=UTC -e LOGGER_LEVEL=info \
  nocobase-perf:v2-optimized
```

- 访问：`http://localhost:13011/v/admin/cpml0ns8jie`
- 账号：`admin@nocobase.com` / `admin123`
- 本机 13010 仍是被测宿主生产实例；容器用 13011，互不冲突。

## 容器内验证结果（生产模式）

| 指标 | 结果 |
|---|---|
| 首屏 table rows / cells | 50 / **650** |
| 全选一次点击生效 | ✅，long task 0 ms |
| hover 预取 | page + grid 共 2 个请求 |
| 预取后 click → 可见 | **17 ms**，点击后 0 请求 |
| 缓存页返回 | **17 ms**，0 请求 |
| console error | 0 |
| v2 预载脚本 | 9 个，入口 `index-313b3818.js`；无 moment/vditor 预载 |

## 运维

```bash
docker logs -f nocobase-perf-v2
docker restart nocobase-perf-v2
docker rm -f nocobase-perf-v2   # 仅删除容器，数据库与镜像保留
```
