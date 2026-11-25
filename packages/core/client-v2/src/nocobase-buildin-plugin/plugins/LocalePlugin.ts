/**
 * This file is part of the NocoBase (R) project.
 * Copyright (c) 2020-2024 NocoBase Co., Ltd.
 * Authors: NocoBase Team.
 *
 * This project is dual-licensed under AGPL-3.0 and NocoBase Commercial License.
 * For more information, please refer to: https://www.nocobase.com/agreement.
 */

import { setValidateLanguage } from '@formily/validator';
import dayjs from 'dayjs';
import { App } from 'antd';
import { Plugin } from '../../Plugin';
import { dayjsLocale } from './dayjsLocale';
import { loadConstrueLocale } from './loadConstrueLocale';

const LOCALE_CACHE_PREFIX = 'nocobase:v2:locale';

type LocaleData = {
  lang?: string;
  resources?: Record<string, Record<string, unknown>>;
  cron?: unknown;
  [key: string]: unknown;
};

/**
 * 用入口脚本的 hash 作为构建版本，升级后自动失效旧的 locale 缓存。
 */
function getBuildId() {
  if (typeof document === 'undefined') {
    return 'unknown';
  }
  const entryScript = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]');
  return entryScript?.src?.split('/').pop() || 'dev';
}

function getLocaleCacheKey(locale: string) {
  return `${LOCALE_CACHE_PREFIX}:${locale || 'default'}:${getBuildId()}`;
}

function readLocaleCache(locale: string): LocaleData | undefined {
  try {
    const raw = window.sessionStorage.getItem(getLocaleCacheKey(locale));
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeLocaleCache(locale: string, data: LocaleData) {
  try {
    window.sessionStorage.setItem(getLocaleCacheKey(locale), JSON.stringify(data));
  } catch {
    // 存储不可用或超出配额时忽略，缓存只是优化项。
  }
}

/**
 * 同步后端下发的语言资源到 client-v2 运行时。
 */
export class LocalePlugin extends Plugin {
  private antdAppRegistered = false;

  async afterAdd() {
    const api = this.app.apiClient;
    const locale = api.auth.locale;
    const cached = readLocaleCache(locale);

    if (cached) {
      // 命中缓存时先应用，立即参与首屏渲染；随后后台校验最新语言资源。
      await this.applyLocaleData(cached);
      this.refreshLocale(locale).catch((error) => {
        console.error('[NocoBase] Failed to refresh locale resources', error);
      });
      return;
    }

    const data = await this.fetchLocale(locale);
    await this.applyLocaleData(data);
    writeLocaleCache(locale, data);
  }

  private async fetchLocale(locale: string): Promise<LocaleData> {
    const res = await this.app.apiClient.request({
      url: 'app:getLang',
      params: {
        locale,
      },
      headers: {
        'X-Role': 'anonymous',
      },
    });
    return res?.data?.data || {};
  }

  private async refreshLocale(locale: string) {
    const data = await this.fetchLocale(locale);
    // 缓存命中后后台校验通常拿到完全相同的内容；跳过重复应用可避免
    // defineProperty 清缓存、i18n.changeLanguage 与全量 addResources 引起的二次渲染。
    if (JSON.stringify(data) !== JSON.stringify(readLocaleCache(locale))) {
      await this.applyLocaleData(data);
    }
    writeLocaleCache(locale, data);
  }

  private async applyLocaleData(data: LocaleData) {
    const api = this.app.apiClient;
    this.engine.context.defineProperty('locales', { value: data });
    if (!this.antdAppRegistered) {
      this.app.use(App, { component: false });
      this.antdAppRegistered = true;
    }

    if (data.lang) {
      api.auth.setLocale(data.lang);
      this.app.setDocumentLanguage(data.lang);
      this.app.i18n.changeLanguage(data.lang);
    }

    Object.keys(data.resources || {}).forEach((key) => {
      this.app.i18n.addResources(data.lang, key, data.resources[key] || {});
    });

    setValidateLanguage(data.lang);
    loadConstrueLocale(data);

    const dayjsLang = dayjsLocale[data.lang] || 'en';
    await import(`dayjs/locale/${dayjsLang}`);
    dayjs.locale(dayjsLang);

    window['cronLocale'] = data.cron;
  }
}
