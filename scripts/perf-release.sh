#!/usr/bin/env bash
# NocoBase 表格性能优化：私有 registry + 自建镜像发布脚本
# 用法：按顺序手动执行各 STEP，或设置 RUN_ALL=1 全自动（含破坏性部署，谨慎）
# 前置：Node 22 / Yarn 1.22 / Docker / 已登录 GitHub PAT（含 workflow scope）
set -euo pipefail

REGISTRY_URL="${REGISTRY_URL:-http://localhost:4873/}"
BUILD_INTERNAL_URL="${BUILD_INTERNAL_URL:-http://host.docker.internal:4873/}"
CNA_VERSION="${CNA_VERSION:-2.2.51}"
PERF_VERSION="${PERF_VERSION:-2.2.51-perf.1}"
IMAGE="${IMAGE:-your-registry/nocobase-perf:${PERF_VERSION}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== 配置 =="
echo "  ROOT=$ROOT  REGISTRY=$REGISTRY_URL  CNA=$CNA_VERSION  PERF=$PERF_VERSION  IMAGE=$IMAGE"

# ---------------------------------------------------------------------------
# STEP 1: 启动 verdaccio（本地私有 registry，默认 uplink 代理官方 npm）
# ---------------------------------------------------------------------------
step1_verdaccio() {
  echo "== STEP 1: 启动 verdaccio =="
  if docker ps --format '{{.Names}}' | grep -qx verdaccio-perf; then
    echo "  verdaccio-perf 已运行，跳过"
  else
    docker run -d --name verdaccio-perf \
      -p 4873:4873 \
      -v "$ROOT/.verdaccio-storage:/verdaccio/storage" \
      verdaccio/verdaccio:5
    echo "  等待 verdaccio 就绪..."
    sleep 8
  fi
  echo "  验证 uplink（应返回官方版本号）:"
  npm view react version --registry "$REGISTRY_URL"
}

# ---------------------------------------------------------------------------
# STEP 2: 登录 verdaccio（官方 Dockerfile 用 test/test 登录）
# ---------------------------------------------------------------------------
step2_login() {
  echo "== STEP 2: 登录私有 registry =="
  # 交互登录；CI 可用 NPM_AUTH_TOKEN 环境变量
  npm login --registry "$REGISTRY_URL" --auth-type=legacy || true
}

# ---------------------------------------------------------------------------
# STEP 3: 构建 monorepo（全量，确保依赖声明正确）
# ---------------------------------------------------------------------------
step3_build() {
  echo "== STEP 3: 全量构建 =="
  cd "$ROOT"
  yarn install --frozen-lockfile
  yarn build   # 约 5 分钟，产出 dist/client/v 与各包 es/lib
}

# ---------------------------------------------------------------------------
# STEP 4: 发布改动包到私有 registry
# ---------------------------------------------------------------------------
step4_publish() {
  echo "== STEP 4: 发布改动包 =="
  cd "$ROOT"
  # 方式 A：lerna 批量发布所有改动包（推荐，含 client-v2 及依赖链）
  yarn lerna publish from-package --yes --registry "$REGISTRY_URL"

  # 方式 B：仅发布 client-v2（若只想针对性发布）
  # cd "$ROOT/packages/core/client-v2"
  # npm version "$PERF_VERSION" --no-git-tag-version
  # npm publish --registry "$REGISTRY_URL" --tag perf
}

# ---------------------------------------------------------------------------
# STEP 5: 验证私有包可被拉取
# ---------------------------------------------------------------------------
step5_verify() {
  echo "== STEP 5: 验证私有包 =="
  npm view @nocobase/client-v2 versions --registry "$REGISTRY_URL" | tail -5
  echo "  确认含 $PERF_VERSION 或你发布的版本号"
}

# ---------------------------------------------------------------------------
# STEP 6: 构建自建镜像（用官方 Dockerfile 的 VERDACCIO_URL 参数）
# ---------------------------------------------------------------------------
step6_image() {
  echo "== STEP 6: 构建镜像 =="
  cd "$ROOT"
  COMMIT_HASH="$(git rev-parse HEAD)"
  docker build \
    -f Dockerfile \
    --build-arg VERDACCIO_URL="$BUILD_INTERNAL_URL" \
    --build-arg CNA_VERSION="$CNA_VERSION" \
    --build-arg COMMIT_HASH="$COMMIT_HASH" \
    --build-arg BEFORE_PACK_NOCOBASE="yarn add @nocobase/client-v2@${PERF_VERSION} -W --production" \
    -t "$IMAGE" \
    .
  echo "  镜像已构建: $IMAGE"
  echo "  （如需推送）docker push $IMAGE"
}

# ---------------------------------------------------------------------------
# STEP 7: 部署替换 noco-test-v2（破坏性，需明确确认）
# ---------------------------------------------------------------------------
step7_deploy() {
  echo "== STEP 7: 部署（破坏性）=="
  echo "  ⚠️ 此步骤会替换 13000 端口的 noco-test-v2，请确认已备份数据"
  # 生成 docker-compose 片段
  cat > "$ROOT/docker-compose.perf.yml" <<EOF
services:
  app:
    image: ${IMAGE}
    environment:
      - DB_HOST=host.docker.internal
      - DB_PORT=54316
      - DB_DATABASE=noco_v2
      - DB_USER=postgres
      - DB_PASSWORD=Ruman801220
      - APP_KEY=your-secret-key
    ports:
      - "13000:80"
EOF
  echo "  已生成 docker-compose.perf.yml，请检查后再执行："
  echo "    docker compose -f docker-compose.perf.yml up -d"
}

# ---------------------------------------------------------------------------
# 分发方式选择
# ---------------------------------------------------------------------------
case "${1:-help}" in
  verdaccio) step1_verdaccio ;;
  login)     step2_login ;;
  build)     step3_build ;;
  publish)   step4_publish ;;
  verify)    step5_verify ;;
  image)     step6_image ;;
  deploy)    step7_deploy ;;
  all)
    step1_verdaccio; step2_login; step3_build; step4_publish
    step5_verify; step6_image
    echo "  all 模式不自动执行 deploy（破坏性）；确认后单独运行: $0 deploy"
    ;;
  *)
    echo "用法: $0 <verdaccio|login|build|publish|verify|image|deploy|all>"
    echo ""
    echo "推荐顺序:"
    echo "  1. $0 verdaccio   # 启动私有 registry"
    echo "  2. $0 login       # 登录"
    echo "  3. $0 build       # 全量构建"
    echo "  4. $0 publish     # 发布改动包"
    echo "  5. $0 verify      # 验证"
    echo "  6. $0 image       # 构建镜像"
    echo "  7. $0 deploy      # 部署（破坏性，需确认）"
    ;;
esac
