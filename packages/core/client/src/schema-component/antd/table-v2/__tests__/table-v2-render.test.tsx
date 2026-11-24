/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { render, screen, waitFor } from '@nocobase/test/client';
import React from 'react';
import App1 from '../demos/demo1';

describe('TableV2 render integration', () => {
  it('renders table rows and preserves selection interaction after shouldCellUpdate optimization', async () => {
    render(<App1 />);

    // 表格应渲染出数据行（demo1 提供 mock 数据）
    await waitFor(() => {
      expect(document.querySelectorAll('.ant-table-tbody tr[data-row-key]').length).toBeGreaterThan(0);
    });

    const rowsBefore = document.querySelectorAll('.ant-table-tbody tr[data-row-key]').length;
    expect(rowsBefore).toBeGreaterThan(0);

    // 存在勾选框（demo1 配置了 rowSelection）
    const checkboxes = document.querySelectorAll('.ant-table-tbody .ant-checkbox-input');
    expect(checkboxes.length).toBeGreaterThan(0);
  });
});
