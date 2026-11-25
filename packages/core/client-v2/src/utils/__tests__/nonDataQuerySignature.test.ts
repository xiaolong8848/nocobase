/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { describe, expect, it } from 'vitest';
import { getBeforeRenderQuerySignature } from '../nonDataQuerySignature';

describe('getBeforeRenderQuerySignature', () => {
  it('ignores cache busters and tracking params', () => {
    expect(getBeforeRenderQuerySignature('?_t=1&filter=abc')).toBe(getBeforeRenderQuerySignature('?_t=999&filter=abc'));
    expect(getBeforeRenderQuerySignature('?timestamp=1&a=2')).toBe(getBeforeRenderQuerySignature('?a=2'));
  });

  it('keeps data params and normalizes their order', () => {
    expect(getBeforeRenderQuerySignature('?b=2&a=1')).toBe(getBeforeRenderQuerySignature('?a=1&b=2'));
    expect(getBeforeRenderQuerySignature('?a=1')).not.toBe(getBeforeRenderQuerySignature('?a=2'));
  });

  it('handles an empty search', () => {
    expect(getBeforeRenderQuerySignature('')).toBe('');
  });
});
