import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { HttpRequest, ResponseRecord } from '../lib/types';
import { applyFilterToText } from '../lib/jq';
import { isSseContent, parseSse } from '../lib/sse';
import { prettyJson } from '../lib/curlParser';
import { copyText, formatBytes, formatMs, maskSecret, relativeTime } from '../lib/util';
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

const JQ_PRESETS = [
  { label: 'AI 回复', expr: '.choices[0].message.content // .error.message // .' },
  { label: '模型列表', expr: '.data[].id' },
  { label: 'Claude', expr: '.content[0].text // .error.message // .' },
  { label: 'Gemini', expr: '.candidates[0].content.parts[0].text // .error.message // .' },
];

export const ResponsePane: React.FC<{ req: HttpRequest; dark: boolean }> = ({ req, dark }) => {
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

  const isSse = useMemo(() => (resp ? isSseContent(resp.contentType, resp.body) : false), [resp]);
  const parsedSse = useMemo(() => (isSse && resp ? parseSse(resp.body) : null), [isSse, resp]);
  const isImage = useMemo(() => !!(resp?.bodyBase64 && /^image\//i.test(resp.contentType)), [resp]);
  const isHtml = useMemo(() => !!(resp && /text\/html/i.test(resp.contentType)), [resp]);

  const filterExpr = req.responseFilter ?? '';
  const filterResult = useMemo(() => {
    if (!resp || !resp.body || !filterExpr.trim() || !filterEnabled || isSse) return null;
    return applyFilterToText(filterExpr.trim(), resp.body);
  }, [resp, filterExpr, filterEnabled, isSse]);

  const displayedBody = useMemo(() => {
    if (!resp) return '';
    if (filterResult?.ok) return filterResult.output;
    if (bodyMode === 'pretty') {
      const p = prettyJson(resp.body);
      if (p !== null) return p;
    }
    return resp.body;
  }, [resp, filterResult, bodyMode]);

  const editorLang: CodeLang = useMemo(() => {
    if (!resp) return 'text';
    if (filterResult?.ok) {
      const t = filterResult.output.trim();
      return t.startsWith('{') || t.startsWith('[') ? 'json' : 'text';
    }
    return bodyMode === 'raw' ? 'text' : detectLang(resp.contentType, resp.body);
  }, [resp, filterResult, bodyMode]);

  const downloadBody = () => {
    if (!resp) return;
    const blob = resp.bodyBase64
      ? new Blob([Uint8Array.from(atob(resp.bodyBase64), (c) => c.charCodeAt(0))], { type: resp.contentType || 'application/octet-stream' })
      : new Blob([displayedBody], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const ext = resp.contentType.includes('json') ? 'json' : resp.contentType.includes('html') ? 'html' : 'txt';
    a.download = `${req.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.${ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filteredHeaders = useMemo(() => {
    if (!resp) return [];
    const q = headerQuery.trim().toLowerCase();
    return q ? resp.headers.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)) : resp.headers;
  }, [resp, headerQuery]);

  return (
    <section className="pane" style={{ borderLeft: data.settings.layout === 'horizontal' ? '1px solid var(--border)' : 'none', borderTop: data.settings.layout === 'vertical' ? '1px solid var(--border)' : 'none' }}>
      {/* 状态栏 */}
      <div className="resp-status-bar">
        <div className="status-group">
          {running && (
            <span className="pill pill-accent">
              {resp && resp.status > 0 ? '接收流式数据中…' : '正在发送…'}
            </span>
          )}
          {resp && !resp.error && resp.status > 0 && (
            <>
              <span className={`status-pill ${statusClass(resp.status)}`}>
                {resp.status} {resp.statusText}
              </span>
              <span className="metric-chip" title={resp.ttfbMs ? `首字节 TTFB：${formatMs(resp.ttfbMs)}` : undefined}>
                {formatMs(resp.timeMs)}
              </span>
              <span className="metric-chip">{formatBytes(resp.size)}</span>
              {resp.redirects && resp.redirects.length > 0 && (
                <span className="pill pill-info" title={resp.redirects.join('\n')}>
                  {resp.redirects.length} 次重定向
                </span>
              )}
              {isSse && <span className="pill pill-accent">SSE 流式</span>}
            </>
          )}
          {resp?.error && <span className="status-pill status-err">请求异常</span>}
          {!resp && !running && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>响应结果</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {resp && !resp.error && (
            <>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="复制当前显示内容"
                onClick={() => {
                  copyText(isSse && parsedSse?.assembledText ? parsedSse.assembledText : displayedBody);
                  toast('已复制响应内容', 'success');
                }}
              >
                <IconCopy size={13} />
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" title="下载响应文件" onClick={downloadBody}>
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
              title="查看历史响应"
            >
              <IconHistory size={13} />
              <span>历史{history.length > 0 ? ` (${history.length})` : ''}</span>
            </button>
            {histOpen && (
              <div className="menu-pop right" style={{ minWidth: 270, maxHeight: 320, overflowY: 'auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px' }}>
                  <span className="menu-title" style={{ padding: 0 }}>
                    最近响应记录
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)', height: 20, fontSize: 11 }}
                    onClick={() => {
                      deleteResponseHistory(req.id);
                      setHistOpen(false);
                    }}
                  >
                    清空
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
                      title="删除此记录"
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
          placeholder="jq / JSONPath 筛选（如 .choices[0].message.content // .error.message // .）"
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
                筛选
              </button>
              <button className={!filterEnabled ? 'active' : ''} onClick={() => setFilterEnabled(false)}>
                原始
              </button>
            </div>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              title="清除筛选表达式"
              onClick={() => updateRequest(req.id, { responseFilter: '' })}
            >
              <IconX size={13} />
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: 4 }}>
            {JQ_PRESETS.slice(0, 2).map((p) => (
              <button
                key={p.label}
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
        <div className="jq-error">jq 筛选提示：{filterResult.error}（下方显示原始响应）</div>
      )}

      {!resp ? (
        <div className="empty-state">
          <IconSparkles size={26} />
          <h3>按下 ⌘↵ 或点击「发送」测试接口</h3>
          <p>支持自动解析 AI 返回的 JSON 与 SSE 流式对话，以及导入自 cURL 管道的 jq 表达式实时筛选。</p>
        </div>
      ) : resp.error ? (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div className="error-card">
            <h4>请求未能完成</h4>
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
                响应体
                {filterResult?.ok && <span className="pill pill-success" style={{ padding: '0 5px', fontSize: 10 }}>jq 已筛选</span>}
              </button>
              <button className={`tab-btn ${tab === 'headers' ? 'active' : ''}`} onClick={() => setTab('headers')}>
                响应头
                <span className="tab-count">{resp.headers.length}</span>
              </button>
              <button className={`tab-btn ${tab === 'request' ? 'active' : ''}`} onClick={() => setTab('request')}>
                实际请求
              </button>
            </div>
            {tab === 'body' && !isImage && (
              <div className="segmented">
                <button className={bodyMode === 'pretty' ? 'active' : ''} onClick={() => setBodyMode('pretty')}>
                  {isSse ? '对话视图' : '美化'}
                </button>
                <button className={bodyMode === 'raw' ? 'active' : ''} onClick={() => setBodyMode('raw')}>
                  原始
                </button>
                {(isHtml || isSse) && (
                  <button className={bodyMode === 'preview' ? 'active' : ''} onClick={() => setBodyMode('preview')}>
                    {isSse ? '事件流' : '网页预览'}
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
                      alt="响应图片"
                      style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
                    />
                  </div>
                ) : isSse && parsedSse && bodyMode === 'pretty' ? (
                  <div className="sse-view">
                    {parsedSse.assembledReasoning && (
                      <div>
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4 }}>思考过程</div>
                        <div className="sse-reasoning">{parsedSse.assembledReasoning}</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                        <span>AI 流式回复拼接（共 {parsedSse.events.length} 个事件{parsedSse.done ? ' · 已结束' : ''}）</span>
                      </div>
                      <div className="sse-answer-box">
                        {parsedSse.assembledText || <span style={{ color: 'var(--text-muted)' }}>（暂未解析到对话增量文本，请切换到「事件流」或「原始」查看）</span>}
                      </div>
                    </div>
                  </div>
                ) : isSse && parsedSse && bodyMode === 'preview' ? (
                  <div className="tab-scroll" style={{ padding: 0 }}>
                    {parsedSse.events.map((ev, idx) => (
                      <div key={idx} className="sse-event-row">
                        <span style={{ color: 'var(--text-muted)', width: 32, flexShrink: 0 }}>#{idx + 1}</span>
                        {ev.event && <span className="pill pill-accent">{ev.event}</span>}
                        <span style={{ wordBreak: 'break-all', color: 'var(--text-dim)' }}>{ev.data}</span>
                      </div>
                    ))}
                  </div>
                ) : isHtml && bodyMode === 'preview' ? (
                  <iframe
                    title="HTML 响应预览"
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
                    placeholder="过滤响应头…"
                    value={headerQuery}
                    onChange={(e) => setHeaderQuery(e.target.value)}
                  />
                </div>
                <table className="kv-table">
                  <thead>
                    <tr>
                      <th style={{ width: '36%' }}>名称</th>
                      <th>值</th>
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
                    <span>实际发送地址</span>
                  </div>
                  <div className="mono" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                    <strong>{resp.method}</strong> {resp.url}
                  </div>
                </div>
                {resp.redirects && resp.redirects.length > 0 && (
                  <div className="card" style={{ marginBottom: 12 }}>
                    <div className="card-title">重定向链路</div>
                    {resp.redirects.map((r, i) => (
                      <div key={i} className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
                        {i + 1}. {r}
                      </div>
                    ))}
                  </div>
                )}
                <div className="card" style={{ marginBottom: 12 }}>
                  <div className="card-title">
                    <span>实际发送的请求头</span>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowReqSecrets((v) => !v)}>
                      {showReqSecrets ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                      {showReqSecrets ? '遮罩密钥' : '显示明文'}
                    </button>
                  </div>
                  <table className="kv-table">
                    <tbody>
                      {(resp.requestHeaders ?? []).map(([k, v], i) => {
                        const isSensitive = /authorization|api[-_]?key|token|cookie|secret/i.test(k);
                        const shown = isSensitive && !showReqSecrets ? v.replace(/(Bearer\s+|Basic\s+)?(\S+)/, (_, p, t) => `${p || ''}${maskSecret(t)}`) : v;
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
                    <div className="card-title">实际发送的请求体</div>
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
