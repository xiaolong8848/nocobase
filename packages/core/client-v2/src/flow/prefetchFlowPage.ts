/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import type { FlowEngine } from '@nocobase/flow-engine';

/**
 * 已预取过的页面 uid。避免同一页面在菜单反复 hover 时重复请求。
 */
const prefetchedPageUids = new Set<string>();
const MAX_PREFETCHED_PAGES = 50;

type GridQuery = { parentId: string; subKey: 'grid' };

function collectTabGridQueries(pageData: Record<string, unknown>): GridQuery[] {
  const tabs = (pageData?.subModels as Record<string, unknown> | undefined)?.tabs;
  const tabList: Array<Record<string, unknown>> = Array.isArray(tabs) ? tabs : tabs ? [tabs] : [];
  return tabList
    .filter((tab) => typeof tab?.uid === 'string' && !!tab.uid)
    .map((tab) => ({ parentId: tab.uid as string, subKey: 'grid' as const }));
}

/**
 * 预加载页面模型数据与模型类 chunk，但不实例化模型、不触发 beforeRender。
 *
 * 首次进入一个 V2 页面的主要耗时来自 `flowModels:findOne`（页面 JSON）以及
 * `FlowEngine.resolveModelTree()` 动态 import 插件 model chunk。在菜单 hover 时提前完成这两步，
 * 可以让后续点击导航直接命中缓存。
 */
export async function prefetchFlowPage(
  flowEngine: FlowEngine | undefined,
  pageUid: string | undefined,
  tabUids: string[] = [],
): Promise<void> {
  const repository = flowEngine?.modelRepository;
  if (!flowEngine || !repository?.prefetch || !pageUid) {
    return;
  }
  // 配置模式下页面可能被编辑，预取数据有陈旧风险，直接跳过。
  if (flowEngine.context?.flowSettingsEnabled) {
    return;
  }
  const cacheKey = tabUids.length ? `${pageUid}|${tabUids.join(',')}` : pageUid;
  if (prefetchedPageUids.has(cacheKey)) {
    return;
  }
  if (prefetchedPageUids.size >= MAX_PREFETCHED_PAGES) {
    prefetchedPageUids.clear();
  }
  prefetchedPageUids.add(cacheKey);

  try {
    const pageData = await repository.prefetch({ parentId: pageUid, subKey: 'page' });
    if (!pageData) {
      prefetchedPageUids.delete(cacheKey);
      return;
    }
    const trees: unknown[] = [pageData];
    // 页面 JSON 中的 tabs（旧结构）优先，路由 children 里的 tabs.schemaUid 是当前结构。
    const gridQueries = new Map<string, { parentId: string; subKey: 'grid' }>();
    collectTabGridQueries(pageData).forEach((query) => gridQueries.set(query.parentId, query));
    tabUids.forEach((uid) => {
      if (uid) {
        gridQueries.set(uid, { parentId: uid, subKey: 'grid' as const });
      }
    });
    if (gridQueries.size) {
      const grids = await Promise.all(
        Array.from(gridQueries.values()).map((query) => repository.prefetch?.(query).catch(() => undefined)),
      );
      grids.forEach((grid) => {
        if (grid) {
          trees.push(grid);
        }
      });
    }
    await flowEngine.resolveModelTree(trees);
  } catch {
    // 预取失败不应影响正常导航，后续点击时仍会按原有流程加载；允许下次 hover 重试。
    prefetchedPageUids.delete(cacheKey);
  }
}
