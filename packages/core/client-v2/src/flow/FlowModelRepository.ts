/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { type CreateModelOptions, type FlowEngine, FlowModel, IFlowModelRepository } from '@nocobase/flow-engine';
import type { BaseApplication } from '../BaseApplication';
import { clearPrefetchPageUids } from './prefetchFlowPage';
import _ from 'lodash';

export class MockFlowModelRepository implements IFlowModelRepository<FlowModel> {
  constructor(protected prefix = '') {}
  get models() {
    const models = new Map();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${this.prefix}flow-model:`)) {
        const data = localStorage.getItem(key);
        if (data) {
          const model = JSON.parse(data);
          models.set(model.uid, model);
        }
      }
    }
    return models;
  }

  async findOne(query) {
    const { uid, parentId } = query;
    if (uid) {
      return this.load(uid);
    } else if (parentId) {
      return this.loadByParentId(parentId);
    }
    return null;
  }

  async loadByParentId(parentId: string) {
    for (const model of this.models.values()) {
      if (model.parentId == parentId) {
        console.log('Loading model by parentId:', parentId, model);
        return this.load(model.uid);
      }
    }
    return null;
  }

  // 从本地存储加载模型数据
  async load(uid: string) {
    const data = localStorage.getItem(`${this.prefix}flow-model:${uid}`);
    if (!data) {
      console.warn(`Model with uid ${uid} not found in localStorage.`);
      return null;
    }
    const json = JSON.parse(data);
    for (const model of [...this.models.values()]) {
      if (model.parentId === uid) {
        json.subModels = json.subModels || {};
        if (model.subType === 'array') {
          json.subModels[model.subKey] = json.subModels[model.subKey] || [];
          const subModel = await this.load(model.uid);
          json.subModels[model.subKey].push(subModel);
        } else if (model.subType === 'object') {
          const subModel = await this.load(model.uid);
          if (subModel) {
            json.subModels[model.subKey] = subModel;
          }
        }
      }
    }
    console.log('Loading model:', uid, JSON.stringify(json, null, 2));
    return json;
  }

  // 将模型数据保存到本地存储
  async save(model: FlowModel) {
    const data = model.serialize();
    const currentData = _.omit(data, ['subModels', 'flowEngine']);
    localStorage.setItem(`${this.prefix}flow-model:${model.uid}`, JSON.stringify(currentData));
    console.log('Saving model:', model.uid, currentData);
    for (const subModelKey of Object.keys(model.subModels || {})) {
      const subModelValue = model.subModels[subModelKey];
      if (!subModelValue) continue;
      if (Array.isArray(subModelValue)) {
        for (const subModel of subModelValue) {
          await this.save(subModel);
        }
      } else if (subModelValue instanceof FlowModel) {
        await this.save(subModelValue);
      }
    }
    return data;
  }

  // 从本地存储中删除模型数据
  async destroy(uid: string) {
    localStorage.removeItem(`${this.prefix}flow-model:${uid}`);
    return true;
  }

  async clear() {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(`${this.prefix}flow-model:`)) {
        localStorage.removeItem(key);
      }
    }
    return true;
  }

  async move(sourceId: string, targetId: string, position: 'before' | 'after' = 'after') {
    // TODO
  }

  async duplicate(uid: string) {
    const source = await this.load(uid);
    if (!source) return null;

    const genUid = () => `dup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const cloneTree = (node: any, newParentUid?: string): any => {
      const { subModels, flowEngine, ...rest } = node || {};
      const cloned: any = { ...rest };
      cloned.uid = genUid();
      if (newParentUid) cloned.parentId = newParentUid;

      if (subModels && typeof subModels === 'object') {
        cloned.subModels = {} as Record<string, any>;
        for (const key of Object.keys(subModels)) {
          const value = (subModels as any)[key];
          if (Array.isArray(value)) {
            cloned.subModels[key] = value.map((child) => cloneTree(child, cloned.uid));
          } else if (value && typeof value === 'object') {
            cloned.subModels[key] = cloneTree(value, cloned.uid);
          }
        }
      }
      return cloned;
    };

    // 返回深拷贝的模型树（不直接写入本地存储）
    return cloneTree(source);
  }
}

export class FlowModelRepository implements IFlowModelRepository<FlowModel> {
  constructor(private app: BaseApplication) {}

  private inFlightFindOne = new Map<string, Promise<any>>();

  /** 预取缓存：菜单 hover 时提前拉取页面 JSON，导航时由 findOne 一次性消费。 */
  private prefetchedFindOne = new Map<string, { at: number; data: any }>();
  private static readonly PREFETCH_TTL_MS = 15000;

  private buildFindOneKey(query: any) {
    const uid = query?.uid ?? '';
    const parentId = query?.parentId ?? '';
    const subKey = query?.subKey ?? '';
    return `uid:${uid}|parentId:${parentId}|subKey:${subKey}`;
  }

  private requestFindOne(query: any) {
    return this.app.apiClient
      .request({
        url: 'flowModels:findOne',
        params: _.pick(query, ['uid', 'parentId', 'subKey']),
      })
      .then((response) => response.data?.data);
  }

  private clearPrefetchCache() {
    this.prefetchedFindOne.clear();
    // 写操作后页面 JSON 已变化，允许 hover 重新预取，否则首次切换会退化到未预取路径。
    clearPrefetchPageUids();
  }

  /**
   * 预取模型数据并缓存一小段时间。仅用于“即将导航到该页面”的场景，
   * 不会实例化模型，也不会触发 beforeRender。
   */
  async prefetch(query: any) {
    const key = this.buildFindOneKey(query);
    const cached = this.prefetchedFindOne.get(key);
    if (cached && Date.now() - cached.at <= FlowModelRepository.PREFETCH_TTL_MS) {
      return cached.data;
    }
    const existing = this.inFlightFindOne.get(key);
    if (existing) {
      return existing;
    }
    const promise = this.requestFindOne(query).finally(() => {
      this.inFlightFindOne.delete(key);
    });
    this.inFlightFindOne.set(key, promise);
    const data = await promise.catch(() => undefined);
    if (data) {
      this.prefetchedFindOne.set(key, { at: Date.now(), data });
    }
    return data;
  }

  async findOne(query) {
    const key = this.buildFindOneKey(query);
    const prefetched = this.prefetchedFindOne.get(key);
    if (prefetched) {
      this.prefetchedFindOne.delete(key);
      if (Date.now() - prefetched.at <= FlowModelRepository.PREFETCH_TTL_MS) {
        return _.cloneDeep(prefetched.data);
      }
    }

    const existing = this.inFlightFindOne.get(key);
    if (existing) {
      const data = await existing;
      return data ? _.cloneDeep(data) : data;
    }

    const promise = this.requestFindOne(query).finally(() => {
      this.inFlightFindOne.delete(key);
    });

    this.inFlightFindOne.set(key, promise);
    const data = await promise;
    return data ? _.cloneDeep(data) : data;
  }

  async ensureRouteContent(options: CreateModelOptions) {
    const existing = await this.findOne({ parentId: options.parentId, subKey: options.subKey });
    if (existing) return existing;

    const response = await this.app.apiClient.request({
      method: 'POST',
      url: 'flowModels:save',
      params: { ensureRouteContent: true },
      data: options,
    });
    // 该请求直接走 API 而非 repository.save()，需手动让 hover 预取缓存失效。
    this.clearPrefetchCache();
    const persisted = await this.findOne({ uid: response.data.data });
    if (!persisted) throw new Error('Could not load the initialized route content');
    return persisted;
  }

  async save(model: FlowModel, options?: { onlyStepParams?: boolean }) {
    this.clearPrefetchCache();
    const data = model.serialize();
    if (options?.onlyStepParams) {
      delete data.subModels;
    }
    const response = await this.app.apiClient.request({
      method: 'POST',
      url: 'flowModels:save',
      data,
    });
    return response.data?.data;
  }

  async destroy(uid: string) {
    this.clearPrefetchCache();
    await this.app.apiClient.request({
      method: 'POST',
      url: 'flowModels:destroy',
      params: { filterByTk: uid },
    });
    return true;
  }

  async move(sourceId: string, targetId: string, position: 'before' | 'after' = 'after') {
    this.clearPrefetchCache();
    const response = await this.app.apiClient.request({
      method: 'POST',
      url: 'flowModels:move',
      params: { sourceId, targetId, position },
    });
    return response.data?.data;
  }

  async duplicate(uid: string) {
    this.clearPrefetchCache();
    const response = await this.app.apiClient.request({
      method: 'POST',
      url: 'flowModels:duplicate',
      params: { uid },
    });
    return response.data?.data;
  }
}

// A tab renderer can be mounted again when the UI Editor adds or removes its controls.
const confirmedRouteModels = new WeakSet<FlowModel>();

export function isRouteContentConfirmed(model: FlowModel) {
  return confirmedRouteModels.has(model);
}

export async function loadRouteContentForEditing(engine: FlowEngine, options: CreateModelOptions) {
  const repository = engine.modelRepository;
  if (!(repository instanceof FlowModelRepository)) {
    return engine.loadOrCreateModel(options);
  }

  // A route model can live in the outer engine while its page lives in this view's engine.
  let cached = engine.findModelByParentId(options.parentId, options.subKey);
  if (!cached) {
    engine.forEachModel((model) => {
      if (model.parentId === options.parentId && model.subKey === options.subKey) cached = model;
    });
  }
  if (cached && isRouteContentConfirmed(cached)) return cached;
  const data = await repository.ensureRouteContent({ ...options, uid: cached?.uid });
  if (cached && cached.uid !== data.uid) engine.removeModelWithSubModels(cached.uid);
  const model = await engine.createModelAsync(data);
  if (model.parent && model.parent.subModels[options.subKey] !== model) {
    model.parent.setSubModel(options.subKey, model);
  }
  confirmedRouteModels.add(model);
  return model;
}
