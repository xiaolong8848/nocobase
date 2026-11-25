/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

/** 纯 UI/埋点参数，不参与区块数据刷新判定。 */
export const NON_DATA_QUERY_KEYS = ['_t', '_r', 'timestamp', '__ts'];

/**
 * 删除已知的无关参数并按键排序，避免 URL 上无关的 cache buster 变化
 * 触发区块 beforeRender 强制刷新。
 */
export function getBeforeRenderQuerySignature(search: string): string {
  if (!search) {
    return '';
  }
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (NON_DATA_QUERY_KEYS.includes(key)) {
      return;
    }
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return pairs.sort().join('&');
}
