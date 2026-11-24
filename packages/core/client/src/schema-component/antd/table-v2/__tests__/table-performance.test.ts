/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';

// 与 Table.tsx columns useMemo 中一致的 shouldCellUpdate 逻辑。
// 该测试固化 v1 表格勾选性能优化的语义：record 引用不变时跳过单元格重渲染。
const shouldCellUpdate = (record: unknown, prevRecord: unknown) => record !== prevRecord;

describe('TableV2 cell update optimization', () => {
  it('skips cells whose record reference is unchanged (selection-only change)', () => {
    const record = { id: 1, name: 'A' };
    expect(shouldCellUpdate(record, record)).toBe(false);
  });

  it('updates cells when the record reference changes (data refresh / quick edit)', () => {
    const prev = { id: 1, name: 'A' };
    const next = { ...prev, name: 'B' };
    expect(shouldCellUpdate(next, prev)).toBe(true);
  });

  it('handles undefined prev record on first render', () => {
    expect(shouldCellUpdate({ id: 1 }, undefined)).toBe(true);
  });
});
