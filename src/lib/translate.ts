import type { Language } from './types';

export function tr(lang: Language | undefined, zh: string, en: string): string {
  return lang === 'en' ? en : zh;
}
