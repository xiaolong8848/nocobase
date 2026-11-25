# V2 表格进一步探测：实测 Profiler 与网络体积

> 日期：2026-11-25
> 环境：Docker 容器 `nocobase-perf-v2`，13011，生产模式
> 方法：`browser.cpu` 采样、Resource Timing、`browse.network`；不使用跨调用 wall clock

## 1. 结论

**继续做 cell 渲染微优化已经没有实测依据**。CPU 采样中，勾选 6 次 + 两次页面切换共 4.2 秒，
应用自身热点函数自耗时合计仅几十毫秒（`invalidateFlowCache` 5 ms、`dispatchEvent` 5 ms、
`runFlow` 3.8 ms），大头是采样脚本自身的 MessageChannel 轮询与未归类时间。

剩余可观测成本集中在**首屏网络体积**，而不是交互 CPU。

## 2. 首屏体积构成（生产 dist，113 个资源，约 4.75 MB 编码传输）

| 资源 | 编码 / 解码 | 说明 |
|---|---|---|
| `7814-be41ccd2.js` | **1,353 KB / 4,563 KB** | 初始预载的最大 vendor chunk |
| `@nocobase/plugin-ai/dist/client-v2/index.js` | **895 KB / 3,096 KB** | AI 插件客户端，首屏即加载 |
| `index-313b3818.js` | 516 KB / 1,988 KB | 入口 |
| `app:getLang` | **337 KB / 337 KB** | **未压缩**，99 个命名空间，含大量前缀/非前缀重复 |
| `vendor-antd-ecosystem` | 288 KB / 1,054 KB | 预载 |
| `vendor-antd` | 228 KB / 836 KB | 预载 |
| `vendor-antd-icons` | 161 KB / 790 KB | 预载 |
| `plugin-block-workbench` | 117 KB | 首屏加载 |
| `plugin-kanban` | 105 KB | 首屏加载 |
| `plugin-field-markdown-vditor` | 83 KB | 首屏加载（Vditor 本体已按需，插件壳仍首屏） |
| `perf_table:list` | 18 KB | 表格数据本身很小 |

菜单 hover 预取仅 **14 KB**（两次 `flowModels:findOne`），点击后 0 请求 —— 页面切换已接近网络下限。

## 3. `app:getLang` 细节

- 响应 345,532 字节，`Content-Type: application/json`，**无 `Content-Encoding`**；
  即使请求带 `Accept-Encoding: gzip, deflate, br` 也不压缩。
- 服务端 `packages/core/server/src/gateway/index.ts` 只对静态资源路径调用 `compression()`，
  API 路由没有压缩中间件。
- 语言资源 99 个命名空间，每个同时存在 `@nocobase/plugin-xxx` 与 `xxx` 两份（如
  `plugin-client` 与 `client` 各 59 KB），约一半是重复内容。
- 服务端已支持 `app:getLang?ns=a,b` 过滤（`filterLocaleResources`），客户端 `LocalePlugin` 当前未使用。

## 4. 新候选优化（按风险排序）

### 低风险
1. **热会话跳过 locale 后台二次请求（短 TTL，如 60 秒）**：已经在 sessionStorage 命中时立即应用到首屏，
   后台再发一次 337 KB 校验。对同一标签页连续刷新，短 TTL 内可省这次请求；语言资源极少变化，
   且用户切换语言会改变 cache key，不会串语言。
2. **LocalePlugin 使用 `ns` 过滤**：只取 v2 实际使用的命名空间，可削减重复的非前缀副本。
   需要完整列出 v2 用到的 namespace 并做回归（缺失会显示原始 key），因此属于“低-中风险”。

### 中风险
3. **API 响应启用 gzip**：HTTP 层改动，对 `app:getLang` 可从 337 KB 降到约 80–100 KB。
   需要在 gateway 中为 API 路由加 `compression()`，并排除 SSE / 下载 / 流式接口，避免破坏语义。
4. **AI 插件客户端懒加载**：首屏 895 KB gzip / 3 MB raw。把 chatbox 改为 Suspense + 空闲加载可显著降低
   首屏传输与解析；需保证聊天入口的点击与未读徽标行为不变。
5. **延后非必要插件壳**：`plugin-block-workbench` / `plugin-kanban` / `plugin-field-markdown-vditor`
   合计约 305 KB gzip，评估是否在首屏后才需要。

### 高风险 / 暂不建议
6. 拆分 `7814` 1.35 MB vendor chunk：收益大但涉及构建分包与加载顺序，回归面广。
7. 任何进一步 cell renderer 微优化：CPU 采样未显示热点，收益不可证，反而引入回归风险。

## 5. 推荐下一步

优先验证第 1 项（locale 短 TTL）与第 3 项（API gzip）的真实收益；若首屏体积仍是瓶颈，
再评估第 4 项 AI 懒加载。交互侧不再投入。
