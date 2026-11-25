/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it, vi } from 'vitest';
import type { FlowEngine } from '@nocobase/flow-engine';
import { clearPrefetchPageUids, prefetchFlowPage } from '../prefetchFlowPage';

function createEngine() {
  const prefetch = vi.fn(async (query: { parentId: string; subKey: string }) => ({ query }));
  const resolveModelTree = vi.fn(async () => undefined);
  const engine = {
    context: {},
    modelRepository: { prefetch },
    resolveModelTree,
  } as unknown as FlowEngine;
  return { engine, prefetch, resolveModelTree };
}

describe('prefetchFlowPage', () => {
  it('prefetches the page and the tab grid, then skips repeated hovers', async () => {
    const { engine, prefetch, resolveModelTree } = createEngine();
    clearPrefetchPageUids();

    await prefetchFlowPage(engine, 'page-uid', ['tab-uid']);

    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(prefetch).toHaveBeenCalledWith({ parentId: 'page-uid', subKey: 'page' });
    expect(prefetch).toHaveBeenCalledWith({ parentId: 'tab-uid', subKey: 'grid' });
    expect(resolveModelTree).toHaveBeenCalledTimes(1);

    await prefetchFlowPage(engine, 'page-uid', ['tab-uid']);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it('allows a new prefetch after write operations clear the page uids', async () => {
    const { engine, prefetch } = createEngine();
    clearPrefetchPageUids();

    await prefetchFlowPage(engine, 'page-uid', ['tab-uid']);
    expect(prefetch).toHaveBeenCalledTimes(2);

    clearPrefetchPageUids();

    await prefetchFlowPage(engine, 'page-uid', ['tab-uid']);
    expect(prefetch).toHaveBeenCalledTimes(4);
  });

  it('does not prefetch in settings mode', async () => {
    const { engine, prefetch } = createEngine();
    (engine.context as { flowSettingsEnabled?: boolean }).flowSettingsEnabled = true;
    clearPrefetchPageUids();

    await prefetchFlowPage(engine, 'page-uid', ['tab-uid']);

    expect(prefetch).not.toHaveBeenCalled();
  });
});
