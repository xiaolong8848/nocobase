# v1 表格低风险优化 — 实施文档

> 分支：`perf/table-block-refactor`　|　基于：v2.2.51　|　日期：2026-11-24
> 范围：4 项低风险改动，**不改 schema key、不改 context 形状、不碰 Formily 承重部分**
> 预估收益：交互 15–40%、首屏 5–30%（详见 `V1-LOW-RISK-GAINS-ESTIMATE.md`）

---

## 0. 四项改动总览

| # | 改动 | 文件 | 预估 | 风险 |
|---|---|---|---|---|
| V1-1 | 实现 `optimizeTextCellRender` 死代码快路径 | `table-v2/Table.tsx` | 首屏 5–30% | 中（需保住 ACL/联动） |
| V1-3 | 替换 4 处 `JSON.stringify` 依赖 | `table-v2/Table.tsx` | 交互 10–25% | 低 |
| V1-5 | SubTable linkage hook 加门控 | `association-field/Table.tsx` | SubTable 场景 20–50% | 低 |
| V1-7 | 修复 resize 无用重渲染 | `schema-component/hooks/useBlockSize.ts` | resize >90% | 低 |

**执行顺序**：V1-3 + V1-5 + V1-7（低风险，先做、先验证）→ V1-1（最后做，最复杂）。每项独立 commit，可单独 revert。

---

## V1-3：替换 `JSON.stringify` 依赖（低风险，先做）

### 现状（已核查行号）
`Table.tsx` 共 4 处：
- `:472` `[JSON.stringify({ ...pagination1, ...pagination2 })]`
- `:1036` `[JSON.stringify(rowKey), defaultRowKey]`
- `:1086` `useMemo(() => rowSelection, [JSON.stringify(rowSelection)])` ← **最危险**：JSON.stringify 丢弃函数，handler 陈旧
- `:1202` `[selectedRow, highlightRow, JSON.stringify(rowKey)]`

### 改法
- `:1086`：`rowSelection` 含 `onChange`/`renderCell` 等函数，**不能用字符串化**。改为按稳定引用或显式字段依赖。最稳妥：直接去掉这个 useMemo（让 rowSelection 每次随 restProps 重算），或拆出 `selectedRowKeys`/`type`/`columnWidth` 等标量做依赖
- `:472` / `:1036` / `:1202`：`rowKey` / pagination 对象用 `useDeepCompareMemo`（ahooks 已装）或 `_.isEqual` 包裹的依赖 comparator

### 注意
- 改 `:1086` 可能改变选中行行为，需跑 `rowSelection` 相关 e2e
- `:1067` 有注释「Don't put 'value' in dependencies」——保持，不要引入 value 依赖

### 验收
勾选/取消勾选后 handler 是最新闭包（无陈旧）；e2e 勾选测试通过。

---

## V1-5：SubTable linkage hook 门控（低风险）

### 现状（已核查）
`association-field/Table.tsx:487-509`，`InternalBodyCellComponent` 每格无条件：
```tsx
const { valueMap } = useSatisfiedActionValues({ formValues: record, category: 'style', schema });
```
而主表 `Table.tsx:695-710` 用 `!_.isEmpty(styleRules)` 门控 `GetStyleRules`。

### 改法
在 SubTable 的 cell 组件上做等价门控——但 React hooks 不能条件调用，所以要把 `useSatisfiedActionValues` 拆进一个子组件，仅在有 style rules 时挂载：

```tsx
// 把 valueMap 逻辑抽成子组件，按 styleRules 门控挂载
const hasStyleRules = !_.isEmpty(...); // 从 schema 推导，对照主表 styleRules 的取法
...
{hasStyleRules ? <StyleRulesCell ... /> : <td ...>{props.children}</td>}
```

或更简单：检查 `useSatisfiedActionValues` 是否在无 rules 时可跳过内部工作（看 `useActionValues.ts:20-64` 的 `useEffect` 注册），若能则加一个 `enabled` 参数短路。

### 验收
无联动规则的 SubTable：勾选/编辑/滚动正常；有联动样式的 SubTable：样式仍生效。

---

## V1-7：修复 resize 无用重渲染（低风险）

### 现状（已核查）
`useBlockSize.ts:178-204` 的 `useTableSize`：
```ts
const [width, setTableWidth] = useState<number>();
const calcTableSize = useCallback(debounce(() => { ... setTableWidth(clientRect.width); }, 100), [targetHeight]);
useEventListener('resize', calcTableSize);
return { height: targetHeight, width, tableSizeRefCallback };
```
而 `Table.tsx:1192` 只取 `height`：
```ts
const { height: tableHeight, tableSizeRefCallback } = useTableSize();
```
**`width` 被算出但从不用**，每次 resize 都触发 Table 重渲染 → 经 V1-2 的 columns 重建放大成整表重渲染。

### 改法（最小）
`useTableSize` 增加参数 `measureWidth = false`，仅当调用方需要 width 时才 `setTableWidth`。Table 调用改为 `useTableSize(false)`：

```ts
export const useTableSize = (measureWidth = true) => {
  ...
  const calcTableSize = useCallback(debounce(() => {
    ...
    if (measureWidth) setTableWidth(clientRect.width);
  }, 100), [targetHeight, measureWidth]);
  ...
};
```
`Table.tsx:1192`：`useTableSize(false)`。

**注意**：其他调用 `useTableSize` 的地方若需要 width 保持默认 `true`——需 grep 全部调用点确认。

### 验收
窗口 resize 时 Table 不再因 width 状态更新而重渲染；表格高度自适应仍正常。

---

## V1-1：实现 `optimizeTextCellRender` 快路径（中风险，最后做）

### 现状（已核查）
死代码：声明 `:174,755`、进 memo 依赖 `:303`、设置 `useTableBlockProps.tsx:70` 为 true，但渲染体 `:264-278` 无条件走 `TableCellRender → NocoBaseRecursionField → new Schema`。

### 改法
在 `render` 闭包里按条件分流。快路径必须满足**全部**门禁：

1. `props.optimizeTextCellRender === true`
2. 非设计态（`!designable`）—— 设计器要保留完整 schema 渲染
3. 该列无联动样式规则（对照 `:687-709` 的 `styleRules` 判定）
4. 该列在 `schemaInWhitelist`（`:188`）内且为简单文本接口（非关联/非编辑/非动作列）
5. ACL 字段白名单允许（`Table.tsx:181,188` 的 `useACLFieldWhitelist` 结果）

满足则直接渲染文本（沿用字段格式化，如 `toLocaleString`/date format），否则保持原 `TableCellRender` 路径。

### 关键陷阱
- **不能无条件纯文本**：会绕过 ACL 字段白名单导致越权显示，绕过联动样式导致规则失效
- 必须保留 `:245-255` 的 ellipsis/tooltip 行为（若配置）
- 这是"复活死代码"，需新写分流逻辑，不是改一个开关

### 验证顺序
先在 `optimizeTextCellRender: false`（默认）下确认行为完全不变；再对纯文本列打开，对比渲染结果一致（文本/格式/省略）且 ACL 隐藏列仍隐藏。

### 验收
- 纯文本表首屏 15–30% 提升（需基线）
- 关联列/编辑列/ACL 隐藏列/联动列行为与改动前完全一致

---

## 通用不变量（四项都不得违反）

- schema key：`x-component: TableV2`、`table:configure*`、`blockSettings:table`、`fieldSettings:TableColumn`、`x-action-column`
- context 形状：`TableBlockContext` / `useTableBlockProps` 返回值 / `useBlockRequestContext`
- 组件导出：`TableV2` 及其 `.Column`/`.Column.ActionBar`/`.Column.Decorator`/`.Selector`
- 31 个插件 / 83 文件依赖这些契约——四项改动都不触碰它们

---

## 测试与验收

### 复用
- v1 table-v2 4 个单测（`table-v2/__tests__/`）
- 18 个 table e2e（`modules/blocks/data-blocks/table/__e2e__/`：tree/dragSort/displayAssociationFields/linkageStyleSettings/pagination 等）

### 新增
1. **V1-3**：勾选 handler 闭包新鲜度测试
2. **V1-5**：无 rules / 有 rules 的 SubTable 对照
3. **V1-7**：resize 前后渲染次数（Profiler）
4. **V1-1**：纯文本/关联/编辑/ACL/联动 五类列的输出一致性

### 执行
```bash
yarn tc packages/core/client/src/schema-component/antd/table-v2
yarn e2e  # table 相关
yarn eslint --fix <touched files>
```

---

## 提交策略

```
commit 1: perf(v1-table): replace JSON.stringify hook deps (V1-3)
commit 2: perf(v1-table): gate SubTable linkage hook (V1-5)
commit 3: perf(v1-table): skip unused width measurement on resize (V1-7)
commit 4: perf(v1-table): implement optimizeTextCellRender fast path (V1-1)
```
每项独立，出问题可单独 revert。前 3 项（低风险）可先合并验证收益，再决定 V1-1 是否值得做。

---

## 一句话总结

**v1 只做 4 项低风险改动：换掉 4 处 `JSON.stringify` 依赖、给 SubTable linkage hook 加门控、修 resize 无用重渲染、复活 `optimizeTextCellRender` 快路径。不改契约、不碰 Formily、不上虚拟化。先做前 3 项（低风险、可单独验证），V1-1 最后做并严格门禁。**
