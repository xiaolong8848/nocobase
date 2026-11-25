/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { FlowEngine } from '../../flowEngine';
import { FlowModel } from '../flowModel';
import type { ApplyFlowCacheEntry } from '../../types';

function entry(): ApplyFlowCacheEntry {
  return { status: 'resolved', data: undefined, promise: Promise.resolve(undefined) };
}

describe('applyFlowCache index', () => {
  it('deletes only the keys tracked by the model and its forks', () => {
    const engine = new FlowEngine();
    const model = new FlowModel({ uid: 'm', flowEngine: engine, stepParams: {}, subModels: {} });
    const fork = model.createFork({}, 'fork-1');

    const ownKey = 'event:default:{}:beforeRender:m';
    const forkKey = 'event:default:fork-1:{}:beforeRender:m';
    const unrelatedKey = 'event:default:{}:beforeRender:other';

    model.trackApplyFlowCacheKey(ownKey);
    fork.trackApplyFlowCacheKey(forkKey);
    engine.applyFlowCache.set(ownKey, entry());
    engine.applyFlowCache.set(forkKey, entry());
    engine.applyFlowCache.set(unrelatedKey, entry());

    model.invalidateFlowCache('beforeRender');

    expect(engine.applyFlowCache.has(ownKey)).toBe(false);
    expect(engine.applyFlowCache.has(forkKey)).toBe(false);
    expect(engine.applyFlowCache.has(unrelatedKey)).toBe(true);
  });

  it('falls back to scanning when no index was recorded', () => {
    const engine = new FlowEngine();
    const model = new FlowModel({ uid: 'm', flowEngine: engine, stepParams: {}, subModels: {} });
    const key = 'event:beforeRender-beforeRender-m';
    engine.applyFlowCache.set(key, entry());

    model.invalidateFlowCache('beforeRender');

    expect(engine.applyFlowCache.has(key)).toBe(false);
  });
});
