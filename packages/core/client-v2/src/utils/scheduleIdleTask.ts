/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };

type RequestIdleCallbackLike = (
  callback: (deadline: IdleDeadlineLike) => void,
  options?: { timeout?: number },
) => number;

/**
 * 把非关键任务（如徽标计数请求）延后到浏览器空闲时执行，避免与首屏页面数据请求竞争。
 * 返回取消函数，便于在组件卸载时清理。
 */
export function scheduleIdleTask(
  task: () => void,
  options: { timeout?: number; fallbackDelay?: number } = {},
): () => void {
  const { timeout = 3000, fallbackDelay = 1500 } = options;
  const globalWithIdle = globalThis as {
    requestIdleCallback?: RequestIdleCallbackLike;
    cancelIdleCallback?: (handle: number) => void;
  };
  const requestIdleCallback = globalWithIdle.requestIdleCallback;

  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => task(), { timeout });
    return () => globalWithIdle.cancelIdleCallback?.(handle);
  }

  const timer = setTimeout(task, fallbackDelay);
  return () => clearTimeout(timer);
}
