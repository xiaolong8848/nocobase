/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { Context, SIMPLE_PAGINATION_LIMIT } from '@nocobase/actions';
import { assign, isValidFilter } from '@nocobase/utils';
import { pageArgsToLimitArgs } from './utils';
import _ from 'lodash';

/** 表体积估算变化很慢，按 collection 缓存 simplePaginate 决策，避免每次翻页都查 pg_class.reltuples。 */
const SIMPLE_PAGINATION_DECISION_TTL = 10 * 60 * 1000;
const simplePaginateDecisions = new WeakMap<object, { at: number; value: boolean }>();

async function resolveSimplePaginate(ctx: Context, repository): Promise<boolean | undefined> {
  const collection = repository.collection as object | undefined;
  if (!collection || !_.isFunction(repository['getEstimatedRowCount'])) {
    return undefined;
  }
  const cached = simplePaginateDecisions.get(collection);
  if (cached && Date.now() - cached.at < SIMPLE_PAGINATION_DECISION_TTL) {
    return cached.value;
  }

  const count = await repository.getEstimatedRowCount();
  const useSimplePaginate = count > SIMPLE_PAGINATION_LIMIT;
  simplePaginateDecisions.set(collection, { at: Date.now(), value: useSimplePaginate });

  if (useSimplePaginate) {
    const resourceName = ctx.action.resourceName;
    const targetCollection = ctx.dataSource.collectionManager.getCollection(resourceName);
    await ctx.app.db.getRepository('dataSourcesCollections').updateOrCreate({
      filterKeys: ['name', 'dataSourceKey'],
      values: {
        name: targetCollection.name,
        dataSourceKey: ctx.dataSource.options.name,
        options: {
          ...repository.collection?.options,
          simplePaginate: true,
        },
      },
    });
  }
  return useSimplePaginate;
}

function totalPage(total, pageSize): number {
  return Math.ceil(total / pageSize);
}

function findArgs(ctx: Context) {
  const resourceName = ctx.action.resourceName;
  const params = ctx.action.params;

  if (params.tree) {
    if (isValidFilter(params.filter)) {
      params.tree = false;
    } else {
      const [collectionName, associationName] = resourceName.split('.');
      const collection = ctx.dataSource.collectionManager.getCollection(resourceName);
      if (collection.options.tree && !(associationName && collectionName === collection.name)) {
        const foreignKey = collection.treeParentField?.foreignKey || 'parentId';
        assign(params, { filter: { [foreignKey]: null } }, { filter: 'andMerge' });
      }
    }
  }

  const { tree, fields, filter, appends, except, sort } = params;

  return { tree, filter, fields, appends, except, sort };
}

async function listWithPagination(ctx: Context) {
  const { page = 1, pageSize = 50 } = ctx.action.params;

  const repository = ctx.getCurrentRepository();

  let { simplePaginate } = repository.collection?.options || {};

  const options = {
    context: ctx,
    ...findArgs(ctx),
    ...pageArgsToLimitArgs(parseInt(String(page)), parseInt(String(pageSize))),
  };

  Object.keys(options).forEach((key) => {
    if (options[key] === undefined) {
      delete options[key];
    }
  });

  if (_.isUndefined(simplePaginate)) {
    simplePaginate = await resolveSimplePaginate(ctx, repository);
  }

  if (simplePaginate) {
    options.limit = options.limit + 1;

    const rows = await repository.find(options);
    ctx.body = {
      rows: rows.slice(0, pageSize),
      hasNext: rows.length > pageSize,
      page: Number(page),
      pageSize: Number(pageSize),
    };
  } else {
    const [rows, count] = await repository.findAndCount(options);

    ctx.body = {
      count,
      rows,
      page: Number(page),
      pageSize: Number(pageSize),
      totalPage: totalPage(count, pageSize),
    };
  }
}

async function listWithNonPaged(ctx: Context) {
  const repository = ctx.getCurrentRepository();

  const rows = await repository.find({ context: ctx, ...findArgs(ctx) });

  ctx.body = rows;
}

export async function list(ctx: Context, next) {
  const { paginate } = ctx.action.params;

  if (paginate === false || paginate === 'false') {
    await listWithNonPaged(ctx);
    ctx.paginate = false;
  } else {
    await listWithPagination(ctx);
    ctx.paginate = true;
  }

  await next();
}
