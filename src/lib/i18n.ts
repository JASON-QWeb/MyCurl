import { useAppStore } from '../store/useAppStore';
import type { Language } from './types';
import { tr } from './translate';

export { tr, type Language };

/** React 组件双语 Hook */
export function useI18n() {
  const lang: Language = useAppStore((s) => s.data.settings.language ?? 'zh');
  const isEn = lang === 'en';
  const t = (zh: string, en: string) => tr(lang, zh, en);
  return { lang, isEn, t };
}
