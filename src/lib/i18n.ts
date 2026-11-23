import { useAppStore } from '../store/useAppStore';
import type { Language } from './types';

export type { Language };

/** 纯函数双语选择，适合 store 或非组件模块使用 */
export function tr(lang: Language | undefined, zh: string, en: string): string {
  return lang === 'en' ? en : zh;
}

/** React 组件双语 Hook */
export function useI18n() {
  const lang: Language = useAppStore((s) => s.data.settings.language ?? 'zh');
  const isEn = lang === 'en';
  const t = (zh: string, en: string) => (isEn ? en : zh);
  return { lang, isEn, t };
}
