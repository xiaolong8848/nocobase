/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { RouteContext } from '@ant-design/pro-layout';
import _ from 'lodash';
import React, { createContext, FC, memo, useContext, useRef } from 'react';
import {
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
} from 'react-router-dom';

const KeepAliveContext = createContext(true);
const hidden = { display: 'none' };

export const KeepAliveProvider: FC<{ active: boolean; parentActive: boolean }> = memo(
  ({ children, active, parentActive }) => {
    const currentLocationContext = useContext(UNSAFE_LocationContext);
    const currentRouteContext = useContext(UNSAFE_RouteContext);
    const currentDataRouterContext = useContext(UNSAFE_DataRouterContext);
    const currentDataRouterStateContext = useContext(UNSAFE_DataRouterStateContext);
    const routeContextValue = useContext(RouteContext);

    const prevLocationContextRef = useRef(currentLocationContext);
    const prevRouteContextRef = useRef(currentRouteContext);
    const prevDataRouterContextRef = useRef(currentDataRouterContext);
    const prevDataRouterStateContextRef = useRef(currentDataRouterStateContext);
    const prevRouteContextValueRef = useRef(routeContextValue);

    if (active) {
      prevDataRouterContextRef.current = currentDataRouterContext;
      prevDataRouterStateContextRef.current = currentDataRouterStateContext;
      prevRouteContextValueRef.current = routeContextValue;
    }

    if (
      active &&
      !_.isEqual(_.omit(prevLocationContextRef.current.location, 'key'), _.omit(currentLocationContext.location, 'key'))
    ) {
      prevLocationContextRef.current = currentLocationContext;
    }

    if (active && !_.isEqual(prevRouteContextRef.current, currentRouteContext)) {
      prevRouteContextRef.current = currentRouteContext;
    }

    return (
      <div style={active ? { height: '100%' } : hidden}>
        <RouteContext.Provider value={prevRouteContextValueRef.current}>
          <UNSAFE_DataRouterContext.Provider value={prevDataRouterContextRef.current}>
            <UNSAFE_DataRouterStateContext.Provider value={prevDataRouterStateContextRef.current}>
              <UNSAFE_LocationContext.Provider value={prevLocationContextRef.current}>
                <UNSAFE_RouteContext.Provider value={prevRouteContextRef.current}>
                  <KeepAliveContext.Provider value={parentActive === false ? false : active}>
                    {children}
                  </KeepAliveContext.Provider>
                </UNSAFE_RouteContext.Provider>
              </UNSAFE_LocationContext.Provider>
            </UNSAFE_DataRouterStateContext.Provider>
          </UNSAFE_DataRouterContext.Provider>
        </RouteContext.Provider>
      </div>
    );
  },
);

export const useKeepAlive = () => {
  const active = useContext(KeepAliveContext);
  return { active };
};

interface KeepAliveProps {
  uid: string;
  children: (uid: string) => React.ReactNode;
}

const MINIMUM_CACHED_PAGES = 2;
const MAXIMUM_CACHED_PAGES = 2;

const getMaxPageCount = () => {
  const baseCount = MINIMUM_CACHED_PAGES;

  try {
    const memory = (navigator as any).deviceMemory;
    if (memory) {
      return Math.min(Math.max(baseCount, memory * 3), MAXIMUM_CACHED_PAGES);
    }

    const cores = navigator.hardwareConcurrency;
    if (cores) {
      return cores >= 8 ? MAXIMUM_CACHED_PAGES : cores >= 4 ? 7 : baseCount;
    }

    return baseCount;
  } catch (e) {
    return baseCount;
  }
};

const MAX_RENDERED_PAGE_COUNT = getMaxPageCount();

export const KeepAlive: FC<KeepAliveProps> = React.memo(({ children, uid }) => {
  const { active } = useKeepAlive();
  const renderedUidListRef = useRef<string[]>([]);
  const renderedChildrenRef = useRef(new Map<string, React.ReactNode>());

  if (!renderedUidListRef.current.includes(uid)) {
    renderedUidListRef.current.push(uid);
    renderedChildrenRef.current.set(uid, children(uid));
    if (renderedUidListRef.current.length > MAX_RENDERED_PAGE_COUNT) {
      const evictedUid = renderedUidListRef.current.shift();
      if (evictedUid) {
        renderedChildrenRef.current.delete(evictedUid);
      }
    }
  } else {
    // 仅当前活跃页面需要刷新子元素以接收最新路由上下文；非活跃页面复用同一元素引用，避免切换时整页重渲染。
    renderedChildrenRef.current.set(uid, children(uid));
  }

  return (
    <>
      {renderedUidListRef.current.map((renderedUid) => (
        <KeepAliveProvider active={renderedUid === uid} key={renderedUid} parentActive={active}>
          {renderedChildrenRef.current.get(renderedUid)}
        </KeepAliveProvider>
      ))}
    </>
  );
});

KeepAlive.displayName = 'KeepAlive';
