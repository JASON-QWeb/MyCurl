import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { createSearchMatcher, filterJsonContent, filterLinesContent, findTextMatches, type MatchRange } from '../lib/responseSearch';
import type { ResponseStream } from '../lib/responseStream';

type Mode = 'find' | 'filter';
const noHits = { matches: [] as MatchRange[], total: 0, truncated: false };

function searchEvents(stream: ResponseStream, matcher: RegExp | undefined, filter: boolean) {
  let total = 0;
  let stored = 0;
  const field = (value: string) => {
    const start = stored;
    const hits = matcher ? findTextMatches(value, matcher, 5000 - stored) : noHits;
    total += hits.total;
    stored += hits.matches.length;
    return { ...hits, start, value };
  };
  const rows = stream.events.flatMap((ev, idx) => {
    const event = ev.event ? field(ev.event) : { ...noHits, start: stored, value: '' };
    const data = field(ev.data);
    return !filter || data.total || (ev.event && event.total) ? [{ ev, idx, event, data }] : [];
  });
  return { rows, total, stored };
}

export function EventField({ field, active }: { field: { matches: MatchRange[]; value: string; start: number }; active: number }) {
  let pos = 0;
  const parts = field.matches.map(({ from, to }, i) => {
    const before = field.value.slice(pos, from);
    pos = to;
    return <span key={i}>{before}<mark className={'cm-resp-match' + (active === field.start + i ? ' cm-resp-match-active' : '')}>
      {field.value.slice(from, to)}</mark></span>;
  });
  return <>{parts}{field.value.slice(pos)}</>;
}

export function useResponseSearch(body: string, eventsView: ResponseStream | null, enabled: boolean, lineStream: boolean) {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('find');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCase] = useState(false);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matcher = useMemo(() => enabled && open && query ? createSearchMatcher(query, { regex, caseSensitive }) : null,
    [enabled, open, query, regex, caseSensitive]);
  const filter = !!matcher?.ok && mode === 'filter';
  const events = useMemo(() => eventsView && searchEvents(eventsView, matcher?.ok ? matcher.regex : undefined, filter),
    [eventsView, matcher, filter]);
  const result = useMemo(() => {
    if (!filter || !matcher?.ok) return null;
    const t = (zh: string, en: string) => lang === 'en' ? en : zh;
    if (events && eventsView) {
      const output = events.rows.map(({ ev }) => eventsView.format === 'NDJSON' ? ev.data : [
        ...(ev.id !== undefined ? ['id: ' + ev.id] : []), ...(ev.event ? ['event: ' + ev.event] : []),
        ...ev.data.split('\n').map(line => 'data: ' + line),
      ].join('\n')).join(eventsView.format === 'NDJSON' ? '\n' : '\n\n');
      const count = `${events.rows.length} / ${eventsView.events.length}`;
      return { output, matched: !!events.rows.length, label: t(count + ' 事件', count + ' events') };
    }
    const json = lineStream ? null : filterJsonContent(body, matcher.test);
    if (json) return { ...json, label: t(`已筛 ${json.matchedItems} 项`, `${json.matchedItems} matched`) };
    const lines = filterLinesContent(body, matcher.test);
    const count = `${lines.matchedLines} / ${lines.totalLines}`;
    return { ...lines, label: t(count + ' 行', count + ' lines') };
  }, [body, matcher, filter, events, eventsView, lang, lineStream]);
  const output = result?.output ?? body;
  const hits = useMemo(() => !events && matcher?.ok ? findTextMatches(output.replace(/\r\n?/g, '\n'), matcher.regex) : noHits,
    [output, matcher, events]);
  const length = events?.stored ?? hits.matches.length;
  const total = events?.total ?? hits.total;
  const active = Math.min(index, length - 1);
  useEffect(() => { setIndex(0); }, [query, mode, regex, caseSensitive]);
  return { input, open, setOpen, query, setQuery, mode, setMode, regex, setRegex, caseSensitive, setCase,
    result, output, hits, active, total, length, events, error: matcher?.ok === false ? matcher.error : '',
    move: (delta: number) => { if (length) setIndex((active + delta + length) % length); },
    close: () => { setQuery(''); setOpen(false); },
  };
}

export function ResponseSearchBar({ search: s }: { search: ReturnType<typeof useResponseSearch> }) {
  const { t } = useI18n();
  useEffect(() => { s.input.current?.focus(); }, [s.input]);
  return <div className="resp-search-bar">
    <input className="input input-sm" ref={s.input} placeholder={t('查找或筛选响应内容…', 'Search or filter response content…')}
      value={s.query} onChange={e => s.setQuery(e.target.value)} onKeyDown={e => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') { e.preventDefault(); s.move(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') { e.stopPropagation(); s.query ? s.setQuery('') : s.close(); }
      }}/>
    <div className="segmented">{(['find', 'filter'] as const).map(mode =>
      <button key={mode} aria-pressed={s.mode === mode} className={s.mode === mode ? 'active' : ''} onClick={() => s.setMode(mode)}>
        {mode === 'find' ? t('定位', 'Find') : t('仅看匹配', 'Filter')}</button>)}</div>
    <button className="btn btn-sm" aria-pressed={s.caseSensitive} title={t('区分大小写', 'Match case')} onClick={() => s.setCase(!s.caseSensitive)}>Aa</button>
    <button className="btn btn-sm" aria-pressed={s.regex} title={t('正则表达式', 'Regular expression')} onClick={() => s.setRegex(!s.regex)}>.*</button>
    <span role="status" title={s.error}>{s.error ? t('正则表达式无效', 'Invalid regex') :
      !s.query ? '' : `${s.result ? s.result.label + ' · ' : ''}${s.active + 1} / ${s.total}${s.total > s.length ? t('（前 5000）', ' (first 5000)') : ''}`}</span>
    <button className="btn btn-sm" disabled={!s.length} title={t('上一个', 'Previous match')} onClick={() => s.move(-1)}>↑</button>
    <button className="btn btn-sm" disabled={!s.length} title={t('下一个', 'Next match')} onClick={() => s.move(1)}>↓</button>
    <button className="btn btn-sm" title={t('关闭查找', 'Close search')} onClick={s.close}>×</button>
  </div>;
}
