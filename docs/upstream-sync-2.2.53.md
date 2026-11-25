# 从官方 v2.2.51 同步到 v2.2.53 的方案

> 日期：2026-11-25
> Fork：`xiaolong8848/nocobase`，分支 `perf/table-block-refactor`
> 当前基线：`v2.2.51`（merge-base = `74cba85810`），本分支领先 34 个提交

## 1. 现状探测（已执行，只读）

- `upstream` remote 已存在：`https://github.com/nocobase/nocobase.git`
- `git fetch upstream --tags` 已拿到 `v2.2.53`（`68de086c18`）
- `v2.2.51..v2.2.53` 共 **209 个文件变更**，绝大多数是 `package.json` / `lerna.json` 版本号升级；
  实际代码改动只有少数几个修复
- 与本分支改动重叠的文件只有 **2 个**：
  - `packages/core/client-v2/src/flow/FlowModelRepository.ts`
  - `packages/plugins/@nocobase/plugin-ai/src/client-v2/ai-employees/chatbox/components/ChatBoxLayout.tsx`
- 本分支重度改动的其他文件（`gateway/index.ts`、`flowModel.tsx`、`forkFlowModel.ts`、
  `RouterManager.tsx`、`LocalePlugin.ts` 等）官方未动，可视为安全

## 2. 预演合并结果

在临时 worktree 中实际试过 `git merge v2.2.53`：

- `FlowModelRepository.ts`：**自动合并成功**，同时保留我们的 `clearPrefetchPageUids` / 预取缓存
  和官方新增的 `ensureRouteContent` / `loadRouteContentForEditing`
- `ChatBoxLayout.tsx`：**2 处冲突**（import 行、unread 刷新的 useEffect）
- 没有其它冲突

## 3. 推荐步骤

```bash
# 0. 备份当前分支（防止合并后需要回退）
git branch perf/table-block-refactor-backup-2251

# 1. 拉取官方 tag
git fetch upstream --tags

# 2. 在独立集成分支上合并（不要直接污染当前分支）
git checkout -b perf/table-block-refactor-v2253
git merge v2.2.53 --no-edit
```

### 3.1 解决 `ChatBoxLayout.tsx` 冲突

**import 行**（两边特性都要保留）：

```ts
import { CurrentUserContext, scheduleIdleTask, useApp, useMobileLayout } from '@nocobase/client-v2';
```

**unread useEffect**（保留官方的 `eventBus` 与用户/token 门禁，叠加我们的空闲延后）：

```ts
useEffect(() => {
  // 未读数是顶栏徽标，不参与页面内容渲染，延后到空闲时再拉取。
  const cancelInitialFetch = scheduleIdleTask(refreshUnreadCounts);
  eventBus.addEventListener('ws:message:ai-employee-tasks:status', refreshUnreadCounts);
  eventBus.addEventListener('ws:message:ai-conversations:read', refreshUnreadCounts);
  return () => {
    cancelInitialFetch();
    eventBus.removeEventListener('ws:message:ai-employee-tasks:status', refreshUnreadCounts);
    eventBus.removeEventListener('ws:message:ai-conversations:read', refreshUnreadCounts);
  };
}, [eventBus, refreshUnreadCounts]);
```

官方新增的 `repository.refreshAIEmployees()` 是登录后加载 AI 员工的修复，保留原样即可；
若想继续贯彻“顶栏请求延后”，可同样用 `scheduleIdleTask` 包一层，但需回归 AI 员工列表。

### 3.2 一个需要补的小点

官方新增的 `ensureRouteContent()` 直接 POST `flowModels:save`，绕过了我们改造过的
`FlowModelRepository.save()`，因此不会清预取缓存。建议在该 POST 成功后加一行
`this.clearPrefetchCache()`，避免配置写入后 hover 预取拿到旧 JSON。

## 4. 合并后必须做的验证

```bash
yarn eslint --fix <冲突文件>
yarn test packages/core/flow-engine/src/models/__tests__/flowModel.test.ts --run
yarn test packages/core/client-v2/src/flow/__tests__/FlowModelRepository.test.ts --run
yarn test packages/plugins/@nocobase/plugin-ai/src/server/__tests__ --run
yarn tc packages/core/client-v2/src/flow/models/blocks/table
yarn build
```

然后：

1. 重启 13010，复测：勾选一次生效、hover 预取 0 请求、缓存切换 0 请求、`app:getLang` 压缩与 TTL
2. 重建 Docker 镜像 `nocobase-perf:v2-optimized`，重建 13011 容器，重复同样的验证
3. 确认 `package.json` / `lerna.json` 版本已变成 `2.2.53`
4. 全部通过后再推送：

```bash
git push origin perf/table-block-refactor-v2253
```

## 5. 失败回退

```bash
git merge --abort                       # 合并过程中
git reset --hard perf/table-block-refactor-backup-2251   # 已提交后
```

## 6. 建议

用 **merge 而非 rebase**：本分支有 34 个提交且已 push，rebase 会重写历史，影响协作；
merge 保留 fork 历史，冲突只有 1 个文件、2 处，代价最小。
