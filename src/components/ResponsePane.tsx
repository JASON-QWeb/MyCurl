import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { HttpRequest, ResponseRecord } from '../lib/types';
import { applyFilterToText } from '../lib/jq';
import { parseResponseStream, streamCopyText } from '../lib/responseStream';
import { prettyJson } from '../lib/curlParser';
import { copyText, formatBytes, formatMs, maskSecret, relativeTime } from '../lib/util';
import { useI18n } from '../lib/i18n';
import { CodeEditor, type CodeLang } from './CodeEditor';
import {
  IconCopy,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFilter,
  IconHistory,
  IconSparkles,
  IconTrash,
  IconX,
} from './Icons';

function statusClass(code: number, error?: string) {
  if (error || code === 0) return 'status-err';
  if (code < 300) return 'status-2xx';
  if (code < 400) return 'status-3xx';
  if (code < 500) return 'status-4xx';
  return 'status-5xx';
}

function detectLang(ct: string, body: string): CodeLang {
  const lower = ct.toLowerCase();
  if (lower.includes('json') || /^\s*[{[]/.test(body.slice(0, 64))) return 'json';
  if (lower.includes('html')) return 'html';
  if (lower.includes('xml')) return 'xml';
  if (lower.includes('javascript')) return 'javascript';
  return 'text';
}

export const ResponsePane: React.FC<{ req: HttpRequest; dark: boolean; vertical?: boolean }> = ({ req, dark, vertical }) => {
  const {
    data,
    histories,
    activeResponseId,
    inFlight,
    updateRequest,
    selectResponse,
    deleteResponseHistory,
    toast,
  } = useAppStore();
  const { lang, t } = useI18n();

  const jqPresets = [
    { label: t('AI 回复', 'AI Reply'), expr: '.choices[0].message.content // .error.message // .' },
    { label: t('模型列表', 'Models'), expr: '.data[].id' },
    { label: 'Claude', expr: '.content[0].text // .error.message // .' },
    { label: 'Gemini', expr: '.candidates[0].content.parts[0].text // .error.message // .' },
  ];

  const [tab, setTab] = useState<'body' | 'headers' | 'request'>('body');
  const [bodyMode, setBodyMode] = useState<'pretty' | 'raw' | 'preview'>('pretty');
  const [filterEnabled, setFilterEnabled] = useState(true);
  const [histOpen, setHistOpen] = useState(false);
  const [headerQuery, setHeaderQuery] = useState('');
  const [showReqSecrets, setShowReqSecrets] = useState(false);

  const running = inFlight[req.id];
  const history = histories[req.id] ?? [];
  const activeId = activeResponseId[req.id] ?? history[0]?.id ?? null;
  const resp: ResponseRecord | null = running
    ? running.partial
    : history.find((h) => h.id === activeId) ?? history[0] ?? null;

  const receiving = !!running;
  const stream = useMemo(
    () => resp ? parseResponseStream(resp.contentType, resp.body, receiving) : null,
    [resp, receiving],
  );
  const isImage = useMemo(() => !!(resp?.bodyBase64 && /^image\//i.test(resp.contentType)), [resp]);
  const isHtml = useMemo(() => !!(resp && /text\/html/i.test(resp.contentType)), [resp]);

  const filterExpr = req.responseFilter ?? '';
  const filterResult = useMemo(() => {
    if (!resp || !resp.body || !filterExpr.trim() || !filterEnabled || stream) return null;
    return applyFilterToText(filterExpr.trim(), resp.body, lang);
  }, [resp, filterExpr, filterEnabled, stream, lang]);

  const displayedBody = useMemo(() => {
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

  const copyBody = async () => {
    try {
      await copyText(stream ? streamCopyText(stream, displayedBody, bodyMode === 'pretty') : displayedBody);
      toast(t('已复制响应内容', 'Copied response'), 'success');
    } catch {
      toast(t('无法复制响应内容', 'Could not copy the response'), 'error');
    }
  };

  const downloadBody = () => {
    if (!resp) return;
    const ndjson = stream?.format === 'NDJSON';
    const blob = resp.bodyBase64
      ? new Blob([Uint8Array.from(atob(resp.bodyBase64), (c) => c.charCodeAt(0))], { type: resp.contentType || 'application/octet-stream' })
      : new Blob([ndjson ? resp.body : displayedBody], { type: ndjson ? 'application/x-ndjson;charset=utf-8' : 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const ext = ndjson ? 'ndjson' : resp.contentType.includes('json') ? 'json' : resp.contentType.includes('html') ? 'html' : 'txt';
    a.download = `${req.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 0);
  };

  const filteredHeaders = useMemo(() => {
    if (!resp) return [];
    const q = headerQuery.trim().toLowerCase();
    return q ? resp.headers.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) : resp.headers;
  }, [resp, headerQuery]);

  const isVertical = vertical ?? data.settings.layout === 'vertical';

  return (
    <section
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
              <span className={`status-pill ${statusClass(resp.status)}`}>
                {resp.status} {resp.statusText}
              </span>
              <span className="metric-chip" title={resp.ttfbMs ? `TTFB: ${formatMs(resp.ttfbMs)}` : undefined}>
                {formatMs(resp.timeMs)}
              </span>
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
                <IconDownload size={13} />
              </button>
            </>
          )}

          {/* 历史记录下拉 */}
          <div className="dropdown-wrap">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setHistOpen((v) => !v)}
              disabled={history.length === 0}
              title={t('查看历史响应', 'Response history')}
            >
              <IconHistory size={13} />
              <span>{t('历史', 'History')}{history.length > 0 ? ` (${history.length})` : ''}</span>
            </button>
            {histOpen && (
              <div className="menu-pop right" style={{ minWidth: 270, maxHeight: 320, overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
                  <span className="menu-title" style={{ padding: 0 }}>
                    {t('最近响应记录', 'Recent Responses')}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)', height: 20, fontSize: 11 }}
                    onClick={() => {
                      deleteResponseHistory(req.id);
                      setHistOpen(false);
                    }}
                  >
                    {t('清空', 'Clear')}
                  </button>
                </div>
                {history.map((h) => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button
                      className={`menu-item ${h.id === resp?.id ? 'active' : ''}`}
                      onClick={() => {
                        selectResponse(req.id, h.id);
                        setHistOpen(false);
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className={`status-pill ${statusClass(h.status, h.error)}`} style={{ fontSize: 10.5, padding: '1px 5px' }}>
                          {h.error ? 'ERR' : h.status}
                        </span>
                        <span className="mono" style={{ fontSize: 11 }}>
                          {formatMs(h.timeMs)} · {formatBytes(h.size)}
                        </span>
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{relativeTime(h.createdAt)}</span>
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => deleteResponseHistory(req.id, h.id)}
                      title={t('删除此记录', 'Delete entry')}
                    >
                      <IconTrash size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* jq / JSONPath 筛选栏 */}
      <div className="jq-bar">
        <IconFilter size={13} className="jq-icon" />
        <input
          className="jq-input"
          placeholder={t(
            'jq / JSONPath 筛选（如 .choices[0].message.content // .error.message // .）',
            'jq / JSONPath filter (e.g. .choices[0].message.content // .error.message // .)',
          )}
          value={filterExpr}
          onChange={(e) => {
            updateRequest(req.id, { responseFilter: e.target.value });
            if (!filterEnabled) setFilterEnabled(true);
          }}
        />
        {filterExpr.trim() ? (
          <>
            <div className="segmented">
              <button className={filterEnabled ? 'active' : ''} onClick={() => setFilterEnabled(true)}>
                {t('筛选', 'Filtered')}
              </button>
              <button className={!filterEnabled ? 'active' : ''} onClick={() => setFilterEnabled(false)}>
                {t('原始', 'Raw')}
              </button>
            </div>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              title={t('清除筛选表达式', 'Clear filter')}
              onClick={() => updateRequest(req.id, { responseFilter: '' })}
            >
              <IconX size={13} />
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 4 }}>
            {jqPresets.slice(0, 2).map((p) => (
              <button
                key={p.expr}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, height: 22, padding: '0 6px' }}
                onClick={() => {
                  updateRequest(req.id, { responseFilter: p.expr });
                  setFilterEnabled(true);
                }}
                title={p.expr}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {filterResult && !filterResult.ok && (
        <div className="jq-error">
          {t(`jq 筛选提示：${filterResult.error}（下方显示原始响应）`, `jq filter note: ${filterResult.error} (showing raw response)`)}
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
      ) : resp.error ? (
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
                {filterResult?.ok && (
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
            {tab === 'body' && !isImage && (
              <div className="segmented">
                <button className={bodyMode === 'pretty' ? 'active' : ''} onClick={() => setBodyMode('pretty')}>
                  {stream ? t('对话视图', 'Chat') : t('美化', 'Pretty')}
                </button>
                <button className={bodyMode === 'raw' ? 'active' : ''} onClick={() => setBodyMode('raw')}>
                  {t('原始', 'Raw')}
                </button>
                {(isHtml || stream) && (
                  <button className={bodyMode === 'preview' ? 'active' : ''} onClick={() => setBodyMode('preview')}>
                    {stream ? t('事件流', 'Events') : t('网页预览', 'Preview')}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="tab-panel">
            {tab === 'body' && (
              <>
                {isImage ? (
                  <div className="tab-scroll" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <img
                      src={`data:${resp.contentType};base64,${resp.bodyBase64}`}
                      alt={t('响应图片', 'Response image')}
                      style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
                    />
                  </div>
                ) : stream && bodyMode === 'pretty' ? (
                  <div className="sse-view">
                    {stream.error && (
                      <div className="jq-error" role="alert">{t(`流式响应错误：${stream.error}`, `Stream error: ${stream.error}`)}</div>
                    )}
                    {stream.assembledReasoning && (
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>{t('思考过程', 'Reasoning')}</div>
                        <div className="sse-reasoning">{stream.assembledReasoning}</div>
                      </div>
                    )}
                    {(!stream.error || stream.assembledText) && (
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                          <span>
                            {t(
                              `AI 流式回复拼接（共 ${stream.events.length} 个事件${stream.done ? ' · 已结束' : ''}）`,
                              `Assembled ${stream.format} stream (${stream.events.length} events${stream.done ? ' · Done' : ''})`,
                            )}
                          </span>
                        </div>
                        <div className="sse-answer-box">
                          {stream.assembledText || (
                            <span style={{ color: 'var(--text-muted)' }}>
                              {t(
                                '（暂未解析到对话增量文本，请切换到「事件流」或「原始」查看）',
                                '(No text delta parsed yet — switch to "Events" or "Raw" to inspect)',
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : stream && bodyMode === 'preview' ? (
                  <div className="tab-scroll" style={{ padding: 0 }}>
                    {stream.events.map((ev, idx) => (
                      <div key={idx} className="sse-event-row">
                        <span style={{ color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>#{idx + 1}</span>
                        {ev.event && <span className="pill pill-accent">{
                          stream.format === 'NDJSON' && ev.event === 'error' ? t('错误', 'Error') : ev.event
                        }</span>}
                        <span style={{ wordBreak: 'break-all', color: 'var(--text-dim)' }}>{ev.data}</span>
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
                          {v}
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
                        const isSensitive = /authorization|api[-_]?key|token|cookie|secret/i.test(k);
                        const shown = isSensitive && !showReqSecrets ? v.replace(/(Bearer\s+|Basic\s+)?(\S+)/, (_, p, tok) => `${p || ''}${maskSecret(tok)}`) : v;
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
