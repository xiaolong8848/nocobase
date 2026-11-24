# 私有 registry 能否拉取官方 npm registry 的包

> 分支：`perf/table-block-refactor`　|　日期：2026-11-24
> 问题：走私有的 verdaccio 发布，镜像构建时能否同时拉到官方 npm 包

---

## 0. 结论

**可以，而且这正是 verdaccio 的默认行为——但必须正确配置 uplink，否则会拉不到官方包导致构建失败。**

verdaccio 原生支持 **uplink（上游代理）**：对本地没有的包，自动转发到官方 registry（默认 `https://registry.npmjs.org/`）拉取并缓存。这是 verdaccio 的标准用法，NocoBase 官方 CI 就是这么做的。

---

## 1. 关键点：必须配置 `config.yaml` 的 uplinks 和 proxy

仓库自带的 `docker-compose.yml:6-14` 只启动了 `verdaccio/verdaccio` 容器，**没有挂载自定义 config**——用的是镜像默认配置。默认配置里通常已有：

```yaml
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  '@*/*':
    access: $all
    publish: $authenticated
    proxy: npmjs        # ← 关键：未发布的 @scope 包走官方
  '**':
    access: $all
    publish: $authenticated
    proxy: npmjs        # ← 关键：未发布的普通包走官方
```

**只要 `proxy: npmjs` 在，私有 registry 就能在发布自己包的同时，从官方拉取所有依赖**（antd、react、@nocobase/* 官方包等）。

### 必须注意的陷阱
- 如果自定义的 `config.yaml` 里删掉了 `uplinks` 或某条 `proxy`，官方包会 404 → `yarn install` 失败
- 官方 Dockerfile 用 `expect` 以 `test/test/test@nocobase.com` 登录（`Dockerfile:17-30`），所以 verdaccio 需允许该账号发布（默认配置允许 `$authenticated` 发布，test 用户登录后即可）

---

## 2. Dockerfile 只用了一个 registry（这点要注意）

官方 Dockerfile 的 app-builder 阶段把 `VERDACCIO_URL` 设为**唯一** registry：

```
Dockerfile:30  npm login --registry $VERDACCIO_URL
Dockerfile:38  yarn config set registry $VERDACCIO_URL
Dockerfile:38  yarn create nocobase-app ...   # 从 $VERDACCIO_URL 拉
Dockerfile:39  yarn install --production       # 从 $VERDACCIO_URL 拉所有依赖
```

**所以所有包（你的改动包 + 官方包）都经由 verdaccio 这一个入口。** 这要求 verdaccio 必须配好 uplink 转发官方包——否则 `yarn install` 会因为拉不到 antd/react 等而失败。

**好消息**：这正是 verdaccio 的默认配置行为，官方 CI（`build-internal-image.yml:21-23` 起 verdaccio 服务，`:113` 传 `VERDACCIO_URL=http://localhost:4873/`）就是靠这个机制工作的。

---

## 3. 推荐配置（确保 uplink 正确）

在 fork 里加一个 `docker/verdaccio/conf/config.yaml`（并让 docker-compose 挂载它）：

```yaml
storage: /verdaccio/storage
auth:
  htpasswd:
    file: /verdaccio/conf/htpasswd
    max_users: 1000
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    cache: true
    timeout: 60s
packages:
  '@nocobase/*':
    access: $all
    publish: $authenticated
    proxy: npmjs      # 官方 @nocobase 包仍从官方拉
  '@*/*':
    access: $all
    publish: $authenticated
    proxy: npmjs
  '**':
    access: $all
    publish: $authenticated
    proxy: npmjs
listen: 0.0.0.0:4873
```

要点：
- **保留 `uplinks.npmjs` 和所有 `proxy: npmjs`** → 官方包正常拉取
- 你发布的改动包（如 `@nocobase/client-v2`）因为版本/包先存在于本地，verdaccio 优先返回本地版本
- `npm login test/test` 能发布（`$authenticated` 允许）

### 版本冲突的注意点
- 你的 `@nocobase/client-v2` 版本号**不要**和官方同版本冲突（例如官方是 2.2.51，你发布 `2.2.51-perf.1`）
- 但 CNA（`create-nocobase-app`）内部可能固定依赖 `@nocobase/client-v2@2.2.51` 这样的精确版本——若你发布的是不同版本号，CNA 仍会拉官方版本，你的改动不生效！

**这是最关键的陷阱**：必须保证 CNA 及其依赖链解析到**你发布的版本号**，而不是官方版本。做法：
- 发布与官方**相同版本号**（覆盖本地缓存）——不推荐，污染缓存
- 或改 CNA 版本/依赖声明使其指向你的版本（路径 A 的完整做法）

---

## 4. 验证方法

```bash
# 1. 确认 verdaccio 能转发官方包
npm view react version --registry http://<verdaccio>:4873
# 应返回官方版本号（如 18.x），说明 uplink 生效

# 2. 发布你的包后确认本地优先
npm view @nocobase/client-v2 versions --registry http://<verdaccio>:4873
# 应同时看到官方版本 + 你的 perf 版本

# 3. 模拟 CNA 拉包
yarn create nocobase-app test --registry http://<verdaccio>:4873
# 检查 node_modules/@nocobase/client-v2 里的代码是否含你的改动
```

---

## 5. 一句话回答

**Q：走私有的发布，可以拉取到官方的 npm registry 吗？**

**A：可以。verdaccio 默认通过 `uplinks.npmjs` + 各包规则的 `proxy: npmjs` 转发到官方 registry——这正是 NocoBase 官方 CI 的做法。你必须确保自定义 config.yaml 保留这些 proxy 配置，否则官方包（antd/react 等）会 404 导致镜像构建失败。同时注意版本解析：CNA 必须实际解析到你发布的新版本号，否则改动的包不会被使用。**
