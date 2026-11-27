export interface MatchRange { from: number; to: number }

export function createSearchMatcher(query: string, opts: { caseSensitive?: boolean; regex?: boolean } = {}) {
  try {
    const pattern = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(pattern, opts.caseSensitive ? '' : 'i');
    return { ok: true as const, regex, test: (text: string) => regex.test(text) };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

export function findTextMatches(text: string, matcher: RegExp, maxMatches = 5000) {
  const re = new RegExp(matcher.source, matcher.flags.replace(/[gy]/g, '') + 'g');
  const matches: MatchRange[] = [];
  let total = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    total++;
    if (matches.length < maxMatches) matches.push({ from: m.index, to: m.index + m[0].length });
    if (!m[0].length) re.lastIndex += re.unicode && (text.codePointAt(re.lastIndex) ?? 0) > 0xffff ? 2 : 1;
  }
  return { matches, total, truncated: matches.length < total };
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const primitive = (v: Json) => v === null || typeof v !== 'object';
interface Hit { value: Json; count: number }

function filterNode(value: Json, test: (s: string) => boolean, isArrayItem: boolean): Hit | null {
  if (Array.isArray(value)) {
    const kept: Json[] = [];
    for (const item of value) {
      const hit = filterNode(item, test, true);
      if (hit) kept.push(hit.value);
    }
    return kept.length ? { value: kept, count: kept.length } : null;
  }
  if (value === null || typeof value !== 'object') return test(String(value)) ? { value, count: 1 } : null;
  const entries = Object.entries(value);
  if (isArrayItem && entries.some(([key, child]) => test(key) || (primitive(child) && test(String(child))))) {
    return { value, count: 1 };
  }
  const kept = [];
  let count = 0;
  for (const [key, child] of entries) {
    if (!isArrayItem && (test(key) || (primitive(child) && test(String(child))))) {
      kept.push([key, child]);
      count++;
    } else if (primitive(child)) {
      if (isArrayItem) kept.push([key, child]);
    } else {
      const hit = filterNode(child, test, false);
      if (hit) {
        kept.push([key, hit.value]);
        count += hit.count;
      }
    }
  }
  return count ? { value: Object.fromEntries(kept), count } : null;
}

export function filterJsonContent(text: string, test: (s: string) => boolean) {
  let value: Json;
  try { value = JSON.parse(text); } catch { return null; }
  const hit = filterNode(value, test, false);
  return { matched: !!hit, output: hit ? JSON.stringify(hit.value, null, 2) : '', matchedItems: hit?.count ?? 0 };
}

export function filterLinesContent(text: string, test: (s: string) => boolean) {
  const lines = text.split(/\r\n?|\n/);
  const kept = lines.filter(test);
  return { matched: !!kept.length, output: kept.join('\n'), matchedLines: kept.length, totalLines: lines.length };
}
