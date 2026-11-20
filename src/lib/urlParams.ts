import type { KV } from './types';
import { uid } from './util';

export function splitUrl(url: string): { base: string; query: string | null; hash: string } {
  let rest = url ?? '';
  let hash = '';
  const h = rest.indexOf('#');
  if (h >= 0) {
    hash = rest.slice(h);
    rest = rest.slice(0, h);
  }
  const q = rest.indexOf('?');
  if (q < 0) return { base: rest, query: null, hash };
  return { base: rest.slice(0, q), query: rest.slice(q + 1), hash };
}

export function parseQuery(query: string | null): { key: string; value: string }[] {
  if (!query) return [];
  return query
    .split('&')
    .filter((p) => p.length)
    .map((pair) => {
      const idx = pair.indexOf('=');
      return idx >= 0 ? { key: pair.slice(0, idx), value: pair.slice(idx + 1) } : { key: pair, value: '' };
    });
}

export function buildQuery(params: { key: string; value: string; enabled?: boolean }[]): string {
  return params
    .filter((p) => p.enabled !== false && (p.key || p.value))
    .map((p) => (p.value === '' ? p.key : `${p.key}=${p.value}`))
    .join('&');
}

/** URL 改变后，同步 params（保留禁用的参数，尽量复用 id） */
export function syncParamsFromUrl(url: string, prev: KV[]): KV[] {
  const parsed = parseQuery(splitUrl(url).query);
  const enabledPrev = prev.filter((p) => p.enabled);
  const disabled = prev.filter((p) => !p.enabled);
  const next: KV[] = parsed.map((p, i) => ({
    id: enabledPrev[i]?.id ?? uid('kv_'),
    key: p.key,
    value: p.value,
    enabled: true,
  }));
  return [...next, ...disabled];
}

/** params 改变后，重建 URL */
export function syncUrlFromParams(url: string, params: KV[]): string {
  const { base, hash } = splitUrl(url);
  const q = buildQuery(params);
  return base + (q ? `?${q}` : '') + hash;
}
