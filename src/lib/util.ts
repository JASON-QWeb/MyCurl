import type { Language, Settings } from './types';
import { tr } from './translate';

export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-6);
  return `${prefix}${time}${rand}`;
}

export function kv(key = '', value = '', enabled = true) {
  return { id: uid('kv_'), key, value, enabled };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function relativeTime(ts: number, lang?: Language): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return tr(lang, '刚刚', 'Just now');
  if (diff < 3600_000) {
    const minutes = Math.floor(diff / 60_000);
    return tr(lang, `${minutes} 分钟前`, `${minutes}m ago`);
  }
  if (diff < 86400_000) {
    const hours = Math.floor(diff / 3600_000);
    return tr(lang, `${hours} 小时前`, `${hours}h ago`);
  }
  return formatTime(ts).slice(0, 16);
}

/** 遮罩密钥：sk-dem••••9999 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.includes('{{')) return value;
  if (value.length <= 8) return '•'.repeat(value.length);
  const head = value.length > 16 ? 6 : 3;
  const tail = 4;
  return `${value.slice(0, head)}••••${value.slice(-tail)}`;
}

const credentialKey = /^(?:(?:x[-_])?(?:api[-_]?(?:key|token)|(?:access|refresh|auth|private|id)[-_]?token|client[-_]secret|secret(?:[-_]key)?|token|password|passwd)|x-goog-api-key|x-auth-key|(?:ocp-apim-|x-)?subscription-key|authorization|proxy-authorization|cookie|set-cookie)$/i;
const queryKey = /^(?:key|auth|signature|sig)$/i;

export function isCredentialKey(name: string, query = false) {
  return credentialKey.test(name) || (query && queryKey.test(name));
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  fallbackCopy(text);
  return Promise.resolve();
}

function fallbackCopy(text: string) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

export const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--m-get)',
  POST: 'var(--m-post)',
  PUT: 'var(--m-put)',
  PATCH: 'var(--m-patch)',
  DELETE: 'var(--m-delete)',
  HEAD: 'var(--m-head)',
  OPTIONS: 'var(--m-options)',
};

export function methodColor(m: string) {
  return METHOD_COLORS[m.toUpperCase()] ?? 'var(--text-dim)';
}

export function methodShort(m: string) {
  const u = m.toUpperCase();
  if (u === 'DELETE') return 'DEL';
  if (u === 'OPTIONS') return 'OPT';
  if (u === 'PATCH') return 'PTCH';
  return u;
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function isDarkTheme(theme: Settings['theme'], systemDark?: boolean) {
  return theme === 'dark' || (theme === 'system' &&
    (systemDark ?? globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false));
}

export function downloadJsonFile(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
