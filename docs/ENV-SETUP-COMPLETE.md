# 开发环境搭建完成记录

> 日期：2026-11-24

## 环境状态

| 项 | 值 |
|---|---|
| 本地目录 | `/Users/xiaolong/nocobase-perf` |
| 基线版本 | v2.2.51 (74cba858) |
| 工作分支 | `perf/table-block-refactor` |
| origin（可 push） | `https://github.com/xiaolong8848/nocobase.git` |
| upstream（同步官方） | `https://github.com/nocobase/nocobase.git` |
| 远端分支 | `d29971a571` 已推送 |
| Git 身份 | xiaolong8848 / xiaolong8848@gmail.com |
| 文档 | 18 篇，已迁移并提交 |
| Token | fine-grained PAT（已补 workflow scope，可推送含 workflows 的提交） |

## 已完成步骤

1. ✅ GitHub fork 官方仓库 → xiaolong8848/nocobase
2. ✅ clone 完整历史（含 v2.2.51 tag）到本地新目录
3. ✅ 配置 origin（fork）+ upstream（官方）
4. ✅ 建分支 perf/table-block-refactor
5. ✅ 迁移 18 篇分析/实施文档
6. ✅ 推送到 fork 远端

## 下一步

- 阶段 5：本地 dev 模式 + pg16 测试（构造基线）
- 阶段 6：实现 Phase 1 代码改动
- 阶段 7：私有 registry + 自建镜像
- 官方同步：`git fetch upstream && git merge upstream/main`

## 常用命令

```bash
cd /Users/xiaolong/nocobase-perf
git checkout perf/table-block-refactor
yarn install --frozen-lockfile
yarn dev    # 端口 13001，DB 指向 pg16:54316

# 同步官方
git fetch upstream && git merge upstream/main

# 推送
git push origin perf/table-block-refactor
```
