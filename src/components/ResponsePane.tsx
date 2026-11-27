import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { HttpRequest, ResponseRecord } from '../lib/types';
import { applyFilterToText } from '../lib/jq';
import { parseResponseStream, streamCopyText } from '../lib/responseStream';
import { extractAiUsage, type AiUsage } from '../lib/aiUsage';
import { prettyJson } from '../lib/curlParser';
import { copyText, formatBytes, formatMs, isCredentialKey, maskSecret } from '../lib/util';
import { isComparableResponse } from '../lib/textDiff';
import { useI18n } from '../lib/i18n';
import { CodeEditor, type CodeLang } from './CodeEditor';
import { useResponseFindShortcut } from './useResponseFindShortcut';
import { EventField, ResponseSearchBar, useResponseSearch } from './ResponseSearchBar';
import { ResponseStreamChat } from './ResponseStreamChat';
import { ResponseDiffView } from './ResponseDiffView';
import { ResponseFilterBar } from './ResponseFilterBar';
import { ResponseHistoryMenu } from './ResponseHistoryMenu';
import { ResponseStatusPill } from './ResponseStatusPill';
import './responsePane.css';
import {
  IconCheck, IconSearch, IconCopy,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconSparkles,
} from './Icons';

function detectLang(ct: string, body: string): CodeLang {
  const lower = ct.toLowerCase();
  if (lower.includes('json') || /^\s*[{[]/.test(body.slice(0, 64))) return 'json';
  if (lower.includes('html')) return 'html';
  if (lower.includes('xml')) return 'xml';
  if (lower.includes('javascript')) return 'javascript';
  return 'text';
}

function sentHeaderValue(key: string, value: string, reveal: boolean) {
  if (reveal || !isCredentialKey(key)) return value;
  const scheme = /^(?:Bearer|Basic)\s+/i.exec(value)?.[0] ?? '';
  const credential = value.slice(scheme.length);
  // A cookie list or a partially resolved template can contain several credentials.
  return scheme + (/[\s;,]|\{\{/.test(credential) ? '••••' : maskSecret(credential));
}

function AiUsageChip({ usage }: { usage: AiUsage }) {
  const { t } = useI18n();
  const { inputTokens, outputTokens, reasoningTokens, totalTokens } = usage;
  const counts = [];
  if (inputTokens !== undefined) counts.push(`↑${inputTokens}`);
  if (outputTokens !== undefined) counts.push(`↓${outputTokens}`);
  if (!counts.length) counts.push(totalTokens ?? `${t('推理', 'Reasoning')} ${reasoningTokens}`);
  const title = [
    t(`输入词元：${inputTokens ?? '—'}`, `Input tokens: ${inputTokens ?? '—'}`),
    t(`输出词元：${outputTokens ?? '—'}`, `Output tokens: ${outputTokens ?? '—'}`),
    t(`推理词元：${reasoningTokens ?? '—'}`, `Reasoning tokens: ${reasoningTokens ?? '—'}`),
    t(`总词元：${totalTokens ?? '—'}`, `Total tokens: ${totalTokens ?? '—'}`),
  ].join('\n');
  return <span className="metric-chip" title={title}>{t(`${counts.join(' ')} 词元`, `${counts.join(' ')} tok`)}</span>;
}

export const ResponsePane: React.FC<{ req: HttpRequest; dark: boolean; vertical?: boolean }> = ({ req, dark, vertical }) => {
  const {
    data,
    histories,
    activeResponseId,
    inFlight,
    toast,
  } = useAppStore();
  const { lang, t } = useI18n();

  const [tab, setTab] = useState<'body' | 'headers' | 'request'>('body');
  const [bodyMode, setBodyMode] = useState<'pretty' | 'raw' | 'preview'>('pretty');
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [comparison, setComparison] = useState<{ requestId: string; targetId: string } | null>(null);
  const [headerQuery, setHeaderQuery] = useState('');
  const [showReqSecrets, setShowReqSecrets] = useState(false);

  const running = inFlight[req.id];
  const history = histories[req.id] ?? [];
  const activeId = activeResponseId[req.id] ?? history[0]?.id ?? null;
  const resp: ResponseRecord | null = running
    ? running.partial
    : history.find((h) => h.id === activeId) ?? history[0] ?? null;
  const baseline = comparison?.requestId === req.id && resp && isComparableResponse(resp)
    ? history.find(h => h.id === comparison.targetId && h.id !== resp.id && isComparableResponse(h)) : undefined;
  useEffect(() => {
    if (comparison && !baseline) setComparison(null);
  }, [comparison, baseline]);

  const receiving = !!running;
  const stream = useMemo(
    () => resp ? parseResponseStream(resp.contentType, resp.body, receiving) : null,
    [resp, receiving],
  );
  const aiUsage = useMemo(() => resp ? extractAiUsage(resp.contentType, resp.body, stream) : null, [resp, stream]);
  const isImage = useMemo(() => !!(resp?.bodyBase64 && /^image\//i.test(resp.contentType)), [resp]);
  const isHtml = useMemo(() => !!(resp && /text\/html/i.test(resp.contentType)), [resp]);

  const filterExpr = req.responseFilter ?? '';
  const filterResult = useMemo(() => {
    if (!resp || !resp.body || !filterExpr.trim() || !filterEnabled || stream) return null;
    return applyFilterToText(filterExpr.trim(), resp.body, lang);
  }, [resp, filterExpr, filterEnabled, stream, lang]);

  const baseBody = useMemo(() => {
    if (!resp) return '';
    if (stream) return resp.body;
    if (filterResult?.ok) return filterResult.output;
    if (bodyMode === 'pretty') {
      const p = prettyJson(resp.body);
      if (p !== null) return p;
    }
    return resp.body;
  }, [resp, filterResult, bodyMode, stream]);

  const editorLang: CodeLang = useMemo(() => {
    if (!resp) return 'text';
    if (filterResult?.ok) {
      const text = filterResult.output.trim();
      return text.startsWith('{') || text.startsWith('[') ? 'json' : 'text';
    }
    return bodyMode === 'raw' ? 'text' : detectLang(resp.contentType, resp.body);
  }, [resp, filterResult, bodyMode]);

  const copy = async (value: string, success: string, failure: string) => {
    try {
      await copyText(value);
      toast(success, 'success');
    } catch {
      toast(failure, 'error');
    }
  };
  const pane = useRef<HTMLElement>(null);
  const searchable = !!resp && !resp.error && !resp.bodyBase64 && !baseline;
  const search = useResponseSearch(baseBody, bodyMode === 'preview' ? stream : null, searchable, !!stream || /ndjson/i.test(resp?.contentType ?? ''));
  const displayedBody = search.output;
  const [focusRequest, requestFocus] = useState(0);
  useEffect(() => {
    if (!search.open) return;
    if (stream && bodyMode === 'pretty') setBodyMode('preview');
    if (!stream && isHtml && bodyMode === 'preview') setBodyMode('raw');
  }, [stream, bodyMode, isHtml, search.open]);
  const openSearch = (selection?: string) => {
    if (selection) { search.setRegex(false); search.setQuery(selection); }
    requestFocus(n => n + 1);
    setTab('body');
    search.setOpen(true);
  };
  useLayoutEffect(() => { if (focusRequest) { search.input.current?.focus(); search.input.current?.select(); } }, [focusRequest, search.input]);
  useResponseFindShortcut(pane, !!resp && !resp.error, searchable, openSearch);
  useEffect(() => {
    if (search.events && search.active >= 0) pane.current?.querySelector('.sse-event-row .cm-resp-match-active')?.scrollIntoView?.({ block: 'nearest' });
  }, [search.active, search.events]);
  const [downloaded, setDownloaded] = useState(0);
  useEffect(() => {
    if (!downloaded) return;
    const timer = setTimeout(() => setDownloaded(0), 1500);
    return () => clearTimeout(timer);
  }, [downloaded]);
  const visibleText = stream && bodyMode === 'pretty' ? streamCopyText(stream, displayedBody, true) : displayedBody;
  const copyBody = () => copy(visibleText,
    t('已复制响应内容', 'Copied response'), t('无法复制响应内容', 'Could not copy the response'));

  const downloadBody = async () => {
    if (!resp) return;
    const chatText = stream && bodyMode === 'pretty' && visibleText !== displayedBody;
    const mimeType = chatText ? 'text/plain;charset=utf-8' : resp.contentType || (resp.bodyBase64 ? 'application/octet-stream' : 'text/plain');
    const mime = mimeType.split(';')[0].toLowerCase();
    const binaryExt = mime.startsWith('image/') ? mime.slice(6).split('+')[0] : mime === 'application/pdf' ? 'pdf' : 'bin';
    const ext = mime.includes('ndjson') ? 'ndjson' : mime.includes('json') ? 'json' : mime.includes('html') ? 'html' : resp.bodyBase64 ? binaryExt : 'txt';
    const name = req.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_') || 'response';
    const saved = await useAppStore.getState().saveAndRecordDownload({
      filename: `${name}${search.result ? '-filtered' : ''}.${ext}`, mimeType, source: 'response', requestName: req.name,
      ...(resp.bodyBase64 ? { base64: resp.bodyBase64 } : { text: visibleText }),
    });
    if (saved) setDownloaded(n => n + 1);
  };

  const filteredHeaders = useMemo(() => {
    if (!resp) return [];
    const q = headerQuery.trim().toLowerCase();
    return q ? resp.headers.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) : resp.headers;
  }, [resp, headerQuery]);

  const isVertical = vertical ?? data.settings.layout === 'vertical';

  return (
    <section ref={pane}
      className="pane"
      style={{
        borderLeft: isVertical ? 'none' : '1px solid var(--border)',
        borderTop: isVertical ? '1px solid var(--border)' : 'none',
      }}
    >
      {/* 状态栏 */}
      <div className="resp-status-bar">
        <div className="status-group">
          {running && (
            <span className="pill pill-accent">
              {resp && resp.status > 0 ? t('接收流式数据中…', 'Streaming…') : t('正在发送…', 'Sending…')}
            </span>
          )}
          {resp && !resp.error && resp.status > 0 && (
            <>
              <ResponseStatusPill resp={resp} />
              <span className="metric-chip">{formatMs(resp.timeMs)}</span>
              <span className="metric-chip">{formatBytes(resp.size)}</span>
              {resp.redirects && resp.redirects.length > 0 && (
                <span className="pill pill-info" title={resp.redirects.join('\n')}>
                  {t(`${resp.redirects.length} 次重定向`, `${resp.redirects.length} redirect(s)`)}
                </span>
              )}
              {stream && <span className="pill pill-accent">{t(`${stream.format} 流式`, `${stream.format} Stream`)}</span>}
            </>
          )}
          {resp?.error && <span className="status-pill status-err">{t('请求异常', 'Request Error')}</span>}
          {resp?.ttfbMs != null && resp.ttfbMs > 0 && (
            <span className="metric-chip" title={t('首字节时间（从发送请求到收到响应的第一个字节）', 'Time to First Byte (from sending the request to receiving the first response byte)')}>
              TTFB {formatMs(resp.ttfbMs)}
            </span>
          )}
          {aiUsage && <AiUsageChip usage={aiUsage} />}
          {!resp && !running && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('响应结果', 'Response')}</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {resp && !resp.error && (
            <>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title={t('复制当前显示内容', 'Copy response')}
                onClick={copyBody}
              >
                <IconCopy size={13} />
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" title={t('下载响应文件', 'Download response')} onClick={downloadBody}>
                {downloaded ? <IconCheck size={13} className="download-saved" /> : <IconDownload size={13} />}
              </button>
            </>
          )}

          <ResponseHistoryMenu requestId={req.id} history={history} current={resp} onCompare={targetId => {
            setComparison({ requestId: req.id, targetId });
            setTab('body');
          }} />
        </div>
      </div>

      <ResponseFilterBar req={req} presetBody={stream ? undefined : resp?.body}
        enabled={filterEnabled} setEnabled={setFilterEnabled} filteredValue={filterResult?.ok ? filterResult.output : undefined} />

      {filterResult && !filterResult.ok && (
        <div className="jq-error">
          {t(`jq 筛选提示：${filterResult.error}（下方显示原始响应）`, `jq filter note: ${filterResult.error} (showing raw response)`)}
          <button className="btn btn-sm" onClick={() => {
            setComparison(null);
            useAppStore.getState().updateRequest(req.id, { responseFilter: '' });
            openSearch();
            search.setRegex(false);
            search.setCase(false);
            search.setQuery(filterExpr.trim());
            search.setMode('filter');
          }}>{t(`按内容筛选「${filterExpr.trim().slice(0, 48)}」`, `Filter body for "${filterExpr.trim().slice(0, 48)}"`)}</button>
        </div>
      )}

      {!resp ? (
        <div className="empty-state">
          <IconSparkles size={26} />
          <h3>{t('按下 ⌘↵ 或点击「发送」测试接口', 'Press ⌘↵ or click "Send" to test')}</h3>
          <p>
            {t(
              '支持自动解析 AI 返回的 JSON 与 SSE 流式对话，以及导入自 cURL 管道的 jq 表达式实时筛选。',
              'Auto-formats JSON and SSE AI streams, with live jq filtering imported from cURL pipes.',
            )}
          </p>
        </div>
      ) : resp.error && !baseline ? (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div className="error-card">
            <h4>{t('请求未能完成', 'Request Failed')}</h4>
            <p>{resp.error}</p>
            <div className="mono" style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
              {resp.method} {resp.url}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="tabs-bar">
            <div className="tabs-list">
              <button className={`tab-btn ${tab === 'body' ? 'active' : ''}`} onClick={() => setTab('body')}>
                {t('响应体', 'Body')}
                {filterResult?.ok && !baseline && (
                  <span className="pill pill-success" style={{ padding: '0 5px', fontSize: 10 }}>
                    {t('jq 已筛选', 'jq filtered')}
                  </span>
                )}
              </button>
              <button className={`tab-btn ${tab === 'headers' ? 'active' : ''}`} onClick={() => setTab('headers')}>
                {t('响应头', 'Headers')}
                <span className="tab-count">{resp.headers.length}</span>
              </button>
              <button className={`tab-btn ${tab === 'request' ? 'active' : ''}`} onClick={() => setTab('request')}>
                {t('实际请求', 'Sent Request')}
              </button>
            </div>
            {tab === 'body' && !isImage && !baseline && (
              <div className="resp-view-controls">
                {searchable && <button className="btn btn-ghost btn-sm" aria-expanded={search.open}
                  title={t('查找/筛选 (⌘F / Ctrl+F)', 'Find / Filter (⌘F / Ctrl+F)')} onClick={() => openSearch()}>
                  <IconSearch size={13}/>{t('查找/筛选', 'Find / Filter')}</button>}
                <div className="segmented">
                  <button className={bodyMode === 'pretty' ? 'active' : ''} onClick={() => { if (stream) search.close(); setBodyMode('pretty'); }}>
                    {stream ? t('对话视图', 'Chat') : t('美化', 'Pretty')}
                  </button>
                  <button className={bodyMode === 'raw' ? 'active' : ''} onClick={() => setBodyMode('raw')}>
                    {t('原始', 'Raw')}
                  </button>
                  {(isHtml || stream) && (
                    <button className={bodyMode === 'preview' ? 'active' : ''} onClick={() => { if (!stream) search.close(); setBodyMode('preview'); }}>
                      {stream ? t('事件流', 'Events') : t('网页预览', 'Preview')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="tab-panel">
            {tab === 'body' && (
              <>
                {searchable && search.open && <ResponseSearchBar search={search} />}
                {search.result && !search.result.matched ? (
                  <div className="empty-state"><h3>{t(`未找到匹配「${search.query}」的内容`, `No matches for "${search.query}"`)}</h3>
                    <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-sm" onClick={() => search.setMode('find')}>{t('定位', 'Find')}</button>
                    <button className="btn btn-sm" onClick={() => { search.setQuery(''); search.input.current?.focus(); }}>{t('清除筛选', 'Clear filter')}</button></div>
                  </div>
                ) : baseline ? (
                  <ResponseDiffView baseline={baseline} current={resp} onExit={() => setComparison(null)} />
                ) : isImage ? (
                  <div className="tab-scroll" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <img
                      src={`data:${resp.contentType};base64,${resp.bodyBase64}`}
                      alt={t('响应图片', 'Response image')}
                      style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
                    />
                  </div>
                ) : stream && bodyMode === 'pretty' ? (
                  <ResponseStreamChat key={resp.id} stream={stream} />
                ) : stream && bodyMode === 'preview' ? (
                  <div className="tab-scroll" style={{ padding: 0 }}>
                    {search.events?.rows.map(({ ev, idx, event, data }) => (
                      <div key={idx} className="sse-event-row">
                        <span style={{ color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>#{idx + 1}</span>
                        {ev.event && <span className="pill pill-accent">{
                          (!search.open || !search.query) && stream.format === 'NDJSON' && ev.event === 'error' ? t('错误', 'Error') : <EventField field={event} active={search.active}/>
                        }</span>}
                        <span style={{ wordBreak: 'break-all', color: 'var(--text-dim)' }}><EventField field={data} active={search.active}/></span>
                      </div>
                    ))}
                  </div>
                ) : isHtml && bodyMode === 'preview' ? (
                  <iframe
                    title={t('HTML 响应预览', 'HTML Preview')}
                    sandbox=""
                    srcDoc={resp.body}
                    style={{ flex: 1, border: 'none', background: '#fff' }}
                  />
                ) : (
                  <CodeEditor
                    value={displayedBody}
                    searchMatches={search.hits.matches} activeMatchIndex={search.active}
                    readOnly
                    language={editorLang}
                    dark={dark}
                    fontSize={data.settings.editorFontSize}
                  />
                )}
              </>
            )}

            {tab === 'headers' && (
              <div className="tab-scroll">
                <div style={{ marginBottom: 8 }}>
                  <input
                    className="input input-sm"
                    style={{ width: '100%' }}
                    data-response-header-filter
                    placeholder={t('过滤响应头…', 'Filter headers…')}
                    value={headerQuery}
                    onChange={(e) => setHeaderQuery(e.target.value)}
                  />
                </div>
                <table className="kv-table">
                  <thead>
                    <tr>
                      <th style={{ width: '36%' }}>{t('名称', 'Name')}</th>
                      <th>{t('值', 'Value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHeaders.map(([k, v], i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontSize: 12, color: 'var(--var-fg)', wordBreak: 'break-all' }}>
                          {k}
                        </td>
                        <td className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                          <div className="response-header-value">
                            <span>{v}</span>
                            <button className="btn btn-ghost btn-icon btn-sm"
                              title={t(`复制 ${k} 的值`, `Copy ${k} value`)}
                              onClick={() => copy(v, t('已复制响应头的值', 'Copied header value'), t('无法复制响应头的值', 'Could not copy header value'))}>
                              <IconCopy size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'request' && (
              <div className="tab-scroll">
                <div className="card" style={{ marginBottom: 12 }}>
                  <div className="card-title">
                    <span>{t('实际发送地址', 'Resolved URL')}</span>
                  </div>
                  <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                    <strong>{resp.method}</strong> {resp.url}
                  </div>
                </div>
                {resp.redirects && resp.redirects.length > 0 && (
                  <div className="card" style={{ marginBottom: 12 }}>
                    <div className="card-title">{t('重定向链路', 'Redirect Chain')}</div>
                    {resp.redirects.map((r, i) => (
                      <div key={i} className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                        {i + 1}. {r}
                      </div>
                    ))}
                  </div>
                )}
                <div className="card" style={{ marginBottom: 12 }}>
                  <div className="card-title">
                    <span>{t('实际发送的请求头', 'Sent Headers')}</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowReqSecrets((v) => !v)}>
                      {showReqSecrets ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                      {showReqSecrets ? t('遮罩密钥', 'Mask Secrets') : t('显示明文', 'Reveal Secrets')}
                    </button>
                  </div>
                  <table className="kv-table">
                    <tbody>
                      {(resp.requestHeaders ?? []).map(([k, v], i) => {
                        const shown = sentHeaderValue(k, v, showReqSecrets);
                        return (
                          <tr key={i}>
                            <td className="mono" style={{ fontSize: 11.5, width: '34%', color: 'var(--var-fg)' }}>
                              {k}
                            </td>
                            <td className="mono" style={{ fontSize: 11.5, wordBreak: 'break-all', color: 'var(--text-dim)' }}>
                              {shown}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {resp.requestBodyPreview && (
                  <div className="card">
                    <div className="card-title">{t('实际发送的请求体', 'Sent Body')}</div>
                    <pre className="md-pre" style={{ margin: 0, maxHeight: 260 }}>
                      <code>{resp.requestBodyPreview}</code>
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};
