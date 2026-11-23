import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Auth, BodyType, HttpRequest, MultipartField } from '../lib/types';
import { findTemplateVars, folderChain, resolveVariables } from '../lib/template';
import { resolveEffectiveAuth, resolveInheritedHeaders } from '../lib/requestRunner';
import { syncParamsFromUrl, syncUrlFromParams } from '../lib/urlParams';
import { copyText, kv, maskSecret, methodColor, uid } from '../lib/util';
import { exportAsCurl } from '../lib/curlExport';
import { prettyJson } from '../lib/curlParser';
import { TemplateInput } from './TemplateInput';
import { CodeEditor } from './CodeEditor';
import { KeyValueTable } from './KeyValueTable';
import { MarkdownView } from './MarkdownView';
import {
  IconCode,
  IconCopy,
  IconDoc,
  IconFolder,
  IconKey,
  IconPlus,
  IconSend,
  IconStop,
  IconTrash,
  IconWand,
} from './Icons';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const COMMON_HEADERS = [
  'Content-Type',
  'Accept',
  'Authorization',
  'User-Agent',
  'X-API-Key',
  'x-api-key',
  'anthropic-version',
  'Cache-Control',
  'Origin',
  'Referer',
  'Cookie',
];

const BODY_TYPES: { id: BodyType; label: string }[] = [
  { id: 'none', label: '无' },
  { id: 'json', label: 'JSON' },
  { id: 'form', label: 'Form 表单' },
  { id: 'multipart', label: 'Multipart' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'xml', label: 'XML' },
  { id: 'text', label: '纯文本' },
];

export const RequestPane: React.FC<{ req: HttpRequest; dark: boolean }> = ({ req, dark }) => {
  const {
    data,
    inFlight,
    updateRequest,
    updateFolder,
    updateEnvironment,
    sendRequest,
    cancelRequest,
    selectFolder,
    openImportModal,
    setExportModal,
    setEnvModal,
    toast,
  } = useAppStore();

  const [tab, setTab] = useState<'body' | 'params' | 'headers' | 'auth' | 'doc' | 'settings'>(() =>
    req.body.type !== 'none' ? 'body' : 'params',
  );
  const [editingDoc, setEditingDoc] = useState(false);

  const sending = !!inFlight[req.id];
  const vars = useMemo(() => resolveVariables(data, req.workspaceId, req.folderId), [data, req.workspaceId, req.folderId]);
  const chain = useMemo(() => folderChain(data, req.folderId), [data, req.folderId]);
  const parentFolder = chain[chain.length - 1] ?? null;
  const effectiveAuth = useMemo(() => resolveEffectiveAuth(data, req), [data, req]);
  const inheritedHeaders = useMemo(() => resolveInheritedHeaders(data, req.folderId), [data, req.folderId]);

  const authVarPickerActions = useMemo(() => {
    const actions: { label: string; onClick: () => void }[] = [];
    if (parentFolder) {
      actions.push({
        label: `管理「${parentFolder.name}」的密钥与变量…`,
        onClick: () => selectFolder(parentFolder.id, 'vars'),
      });
    }
    actions.push({
      label: '打开环境变量与密钥库…',
      onClick: () => setEnvModal(true),
    });
    return actions;
  }, [parentFolder, selectFolder, setEnvModal]);

  // 收集当前请求引用的所有模板变量，方便一眼查看解析结果与来源
  const usedVarNames = useMemo(() => {
    const names = new Set<string>();
    const scan = (s?: string) => findTemplateVars(s ?? '').forEach((n) => names.add(n));
    scan(req.url);
    req.headers.filter((h) => h.enabled).forEach((h) => scan(h.value));
    scan(req.auth.token);
    scan(req.auth.password);
    scan(req.auth.value);
    if (req.body.type === 'json' || req.body.type === 'text' || req.body.type === 'xml') scan(req.body.text);
    return [...names].filter((n) => !n.startsWith('$'));
  }, [req]);

  const handleUrlChange = (nextUrl: string) => {
    const nextParams = syncParamsFromUrl(nextUrl, req.params);
    updateRequest(req.id, { url: nextUrl, params: nextParams });
  };

  const handleParamsChange = (nextParams: HttpRequest['params']) => {
    const nextUrl = syncUrlFromParams(req.url, nextParams);
    updateRequest(req.id, { params: nextParams, url: nextUrl });
  };

  const handleBodyTypeChange = (type: BodyType) => {
    const nextBody = { ...req.body, type };
    let nextHeaders = req.headers;
    const hasCT = req.headers.some((h) => h.enabled && h.key.toLowerCase() === 'content-type');
    if (type === 'json' && !hasCT) {
      nextHeaders = [...req.headers, kv('Content-Type', 'application/json', true)];
    }
    updateRequest(req.id, { body: nextBody, headers: nextHeaders });
  };

  const formatJsonBody = () => {
    const formatted = prettyJson(req.body.text);
    if (formatted !== null) {
      updateRequest(req.id, { body: { ...req.body, text: formatted } });
      toast('已格式化 JSON', 'success');
    } else {
      toast('当前内容不是合法的 JSON（如包含 {{变量}} 占位符，可手动调整）', 'warning');
    }
  };

  const extractTokenToSecret = () => {
    const raw = (req.auth.token ?? '').trim();
    if (!raw || raw.includes('{{')) return;
    if (parentFolder) {
      let name = 'api_key';
      let i = 2;
      const existing = new Set(parentFolder.variables.map((v) => v.key));
      while (existing.has(name)) name = `api_key_${i++}`;
      updateFolder(parentFolder.id, {
        variables: [
          ...parentFolder.variables,
          { id: uid('kv_'), key: name, value: raw, enabled: true, secret: true, note: '手动提取自认证' },
        ],
      });
      updateRequest(req.id, { auth: { ...req.auth, token: `{{${name}}}` } });
      toast(`已收纳到文件夹「${parentFolder.name}」的密钥 {{${name}}}`, 'success');
    } else {
      const base = data.environments.find((e) => e.workspaceId === req.workspaceId && e.isBase);
      if (!base) return;
      let name = 'api_key';
      let i = 2;
      const existing = new Set(base.variables.map((v) => v.key));
      while (existing.has(name)) name = `api_key_${i++}`;
      updateEnvironment(base.id, {
        variables: [
          ...base.variables,
          { id: uid('kv_'), key: name, value: raw, enabled: true, secret: true, note: '手动提取自认证' },
        ],
      });
      updateRequest(req.id, { auth: { ...req.auth, token: `{{${name}}}` } });
      toast(`已收纳到全局密钥 {{${name}}}`, 'success');
    }
  };

  const updateAuth = (patch: Partial<Auth>) => {
    updateRequest(req.id, { auth: { ...req.auth, ...patch } });
  };

  const updateMultipart = (id: string, patch: Partial<MultipartField>) => {
    updateRequest(req.id, {
      body: {
        ...req.body,
        multipart: req.body.multipart.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      },
    });
  };

  const handleFilePick = (fieldId: string, file: File | null) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast('单个上传文件请勿超过 15 MB', 'warning');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      updateMultipart(fieldId, {
        isFile: true,
        fileName: file.name,
        fileData: b64,
        contentType: file.type || 'application/octet-stream',
      });
    };
    reader.readAsDataURL(file);
  };

  const enabledParamsCount = req.params.filter((p) => p.enabled && (p.key || p.value)).length;
  const enabledHeadersCount = req.headers.filter((h) => h.enabled && h.key.trim()).length + inheritedHeaders.length;
  const hasAuth = effectiveAuth.auth.type !== 'none';

  return (
    <section className="pane">
      {/* 顶部标题与面包屑 */}
      <div className="req-header">
        <div className="req-title-group">
          {parentFolder && (
            <button
              className="crumb-btn"
              onClick={() => selectFolder(parentFolder.id)}
              title={`点击打开目录「${parentFolder.name}」的归档文档与密钥`}
            >
              <IconFolder size={12} />
              <span>{parentFolder.name}</span>
            </button>
          )}
          <input
            className="req-name-input"
            value={req.name}
            placeholder="请求名称"
            onChange={(e) => updateRequest(req.id, { name: e.target.value })}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            className="btn btn-ghost btn-sm"
            title="复制为 cURL 命令（密钥脱敏）"
            onClick={() => {
              copyText(exportAsCurl(data, req, { secretMode: 'mask', includeJq: true }));
              toast('已复制 cURL 命令（密钥已脱敏）', 'success');
            }}
          >
            <IconCopy size={13} />
            cURL
          </button>
          <button className="btn btn-ghost btn-sm" title="生成代码（cURL / fetch / Python / Markdown）" onClick={() => setExportModal(req.id)}>
            <IconCode size={13} />
            代码
          </button>
        </div>
      </div>

      {/* URL 地址栏 */}
      <div className="url-bar">
        <div className="url-box">
          <select
            className="method-select"
            value={req.method}
            style={{ color: methodColor(req.method) }}
            onChange={(e) => updateRequest(req.id, { method: e.target.value })}
          >
            {METHODS.map((m) => (
              <option key={m} value={m} style={{ color: 'var(--text)', background: 'var(--bg-elev)' }}>
                {m}
              </option>
            ))}
          </select>
          <TemplateInput
            value={req.url}
            onChange={handleUrlChange}
            vars={vars}
            placeholder="输入请求地址，或直接粘贴 cURL 命令…"
            onEnter={() => sendRequest(req.id)}
            onPasteCurl={(text) => openImportModal(text)}
          />
        </div>
        {sending ? (
          <button className="btn btn-danger send-btn" onClick={() => cancelRequest(req.id)} title="取消发送">
            <IconStop size={13} />
            取消
          </button>
        ) : (
          <button className="btn btn-primary send-btn" onClick={() => sendRequest(req.id)} title="发送请求 (⌘↵)">
            <IconSend size={13} />
            发送
          </button>
        )}
      </div>

      {/* 引用变量实时预览条 */}
      {usedVarNames.length > 0 && (
        <div className="var-preview-bar">
          <span>变量：</span>
          {usedVarNames.map((name) => {
            const v = vars.get(name);
            if (!v) {
              return (
                <button
                  key={name}
                  className="var-chip missing"
                  onClick={() => (parentFolder ? selectFolder(parentFolder.id, 'vars') : setEnvModal(true))}
                  title="变量未定义，点击去添加"
                >
                  {`{{${name}}}`} · 未定义
                </button>
              );
            }
            const shown = v.secret ? maskSecret(v.value) : v.value.length > 36 ? v.value.slice(0, 36) + '…' : v.value;
            return (
              <button
                key={name}
                className={`var-chip ${v.secret ? 'secret' : 'ok'}`}
                onClick={() => (v.sourceKind === 'folder' && v.sourceId ? selectFolder(v.sourceId, 'vars') : setEnvModal(true))}
                title={`来源：${v.source}，点击查看或修改`}
              >
                {v.secret && <IconKey size={10} />}
                <span>{name}</span>
                <span style={{ opacity: 0.72 }}>= {shown || '(空)'}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 请求配置 Tabs */}
      <div className="tabs-bar">
        <div className="tabs-list">
          <button className={`tab-btn ${tab === 'body' ? 'active' : ''}`} onClick={() => setTab('body')}>
            请求体
            {req.body.type !== 'none' && <span className="tab-count">{req.body.type.toUpperCase()}</span>}
          </button>
          <button className={`tab-btn ${tab === 'params' ? 'active' : ''}`} onClick={() => setTab('params')}>
            参数
            {enabledParamsCount > 0 && <span className="tab-count">{enabledParamsCount}</span>}
          </button>
          <button className={`tab-btn ${tab === 'headers' ? 'active' : ''}`} onClick={() => setTab('headers')}>
            请求头
            {enabledHeadersCount > 0 && <span className="tab-count">{enabledHeadersCount}</span>}
          </button>
          <button className={`tab-btn ${tab === 'auth' ? 'active' : ''}`} onClick={() => setTab('auth')}>
            认证
            {hasAuth && <span className="tab-dot" />}
          </button>
          <button className={`tab-btn ${tab === 'doc' ? 'active' : ''}`} onClick={() => setTab('doc')}>
            <IconDoc size={13} />
            文档
            {req.description?.trim() && <span className="tab-dot" />}
          </button>
          <button className={`tab-btn ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>
            设置
          </button>
        </div>
      </div>

      {/* Tab 内容 */}
      <div className="tab-panel">
        {tab === 'body' && (
          <>
            <div className="sub-toolbar">
              <div className="segmented">
                {BODY_TYPES.map((bt) => (
                  <button
                    key={bt.id}
                    className={req.body.type === bt.id ? 'active' : ''}
                    onClick={() => handleBodyTypeChange(bt.id)}
                  >
                    {bt.label}
                  </button>
                ))}
              </div>
              {req.body.type === 'json' && (
                <button className="btn btn-sm btn-ghost" onClick={formatJsonBody} title="格式化 JSON">
                  <IconWand size={12} />
                  格式化
                </button>
              )}
            </div>

            {req.body.type === 'none' && (
              <div className="empty-state">
                <p>此请求不包含请求体。如需提交 JSON 或表单，请在上方切换请求体类型。</p>
              </div>
            )}

            {(req.body.type === 'json' || req.body.type === 'xml' || req.body.type === 'text') && (
              <CodeEditor
                value={req.body.text}
                onChange={(v) => updateRequest(req.id, { body: { ...req.body, text: v } })}
                language={req.body.type}
                dark={dark}
                fontSize={data.settings.editorFontSize}
                vars={vars}
                placeholder={req.body.type === 'json' ? '{\n  "model": "gpt-4o",\n  "messages": []\n}' : '输入请求体内容…'}
                onCtrlEnter={() => sendRequest(req.id)}
              />
            )}

            {req.body.type === 'form' && (
              <div className="tab-scroll">
                <KeyValueTable
                  items={req.body.form}
                  onChange={(form) => updateRequest(req.id, { body: { ...req.body, form } })}
                  vars={vars}
                  keyPlaceholder="字段名"
                  addLabel="添加表单字段"
                />
              </div>
            )}

            {req.body.type === 'multipart' && (
              <div className="tab-scroll">
                <table className="kv-table">
                  <thead>
                    <tr>
                      <th className="kv-check" />
                      <th style={{ width: '28%' }}>字段名</th>
                      <th style={{ width: 82 }}>类型</th>
                      <th>值 / 文件</th>
                      <th className="kv-del" />
                    </tr>
                  </thead>
                  <tbody>
                    {req.body.multipart.map((row) => (
                      <tr key={row.id} className={`kv-row ${row.enabled ? '' : 'disabled'}`}>
                        <td className="kv-check">
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(e) => updateMultipart(row.id, { enabled: e.target.checked })}
                          />
                        </td>
                        <td>
                          <input
                            className="input input-sm mono"
                            style={{ width: '100%' }}
                            value={row.key}
                            placeholder="字段名"
                            onChange={(e) => updateMultipart(row.id, { key: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            className="select select-sm"
                            style={{ width: '100%' }}
                            value={row.isFile ? 'file' : 'text'}
                            onChange={(e) => updateMultipart(row.id, { isFile: e.target.value === 'file' })}
                          >
                            <option value="text">文本</option>
                            <option value="file">文件</option>
                          </select>
                        </td>
                        <td>
                          {row.isFile ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input
                                type="file"
                                style={{ fontSize: 11.5, maxWidth: 210 }}
                                onChange={(e) => handleFilePick(row.id, e.target.files?.[0] ?? null)}
                              />
                              {row.fileName && <span className="pill">{row.fileName}</span>}
                            </div>
                          ) : (
                            <TemplateInput
                              value={row.value}
                              onChange={(v) => updateMultipart(row.id, { value: v })}
                              vars={vars}
                              bordered
                              compact
                            />
                          )}
                        </td>
                        <td className="kv-del">
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() =>
                              updateRequest(req.id, {
                                body: { ...req.body, multipart: req.body.multipart.filter((x) => x.id !== row.id) },
                              })
                            }
                          >
                            <IconTrash size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-sm"
                    onClick={() =>
                      updateRequest(req.id, {
                        body: { ...req.body, multipart: [...req.body.multipart, { ...kv('', ''), isFile: false }] },
                      })
                    }
                  >
                    <IconPlus size={13} />
                    添加字段
                  </button>
                </div>
              </div>
            )}

            {req.body.type === 'graphql' && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  Query / Mutation
                </div>
                <div style={{ flex: 1.5, minHeight: 0, display: 'flex' }}>
                  <CodeEditor
                    value={req.body.graphql?.query ?? ''}
                    onChange={(query) =>
                      updateRequest(req.id, { body: { ...req.body, graphql: { query, variables: req.body.graphql?.variables ?? '' } } })
                    }
                    language="text"
                    dark={dark}
                    fontSize={data.settings.editorFontSize}
                    vars={vars}
                    onCtrlEnter={() => sendRequest(req.id)}
                  />
                </div>
                <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                  Variables (JSON)
                </div>
                <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
                  <CodeEditor
                    value={req.body.graphql?.variables ?? ''}
                    onChange={(variables) =>
                      updateRequest(req.id, { body: { ...req.body, graphql: { query: req.body.graphql?.query ?? '', variables } } })
                    }
                    language="json"
                    dark={dark}
                    fontSize={data.settings.editorFontSize}
                    vars={vars}
                    onCtrlEnter={() => sendRequest(req.id)}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {tab === 'params' && (
          <div className="tab-scroll">
            <KeyValueTable
              items={req.params}
              onChange={handleParamsChange}
              vars={vars}
              keyPlaceholder="参数名"
              valuePlaceholder="参数值（与上方 URL 实时同步）"
              addLabel="添加查询参数"
            />
          </div>
        )}

        {tab === 'headers' && (
          <div className="tab-scroll">
            {inheritedHeaders.length > 0 && (
              <div className="inherited-box">
                <div className="inherited-title">
                  <span>继承自文件夹的公共请求头（{inheritedHeaders.length}）</span>
                </div>
                {inheritedHeaders.map((h, i) => (
                  <div key={i} className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)', padding: '2px 0' }}>
                    <strong>{h.key}:</strong> {h.value}{' '}
                    <span style={{ color: 'var(--text-muted)' }}>({h.inheritedFrom})</span>
                  </div>
                ))}
              </div>
            )}
            <KeyValueTable
              items={req.headers}
              onChange={(headers) => updateRequest(req.id, { headers })}
              vars={vars}
              keyPlaceholder="Header 名称"
              keySuggestions={COMMON_HEADERS}
              addLabel="添加请求头"
            />
          </div>
        )}

        {tab === 'auth' && (
          <div className="tab-scroll" style={{ maxWidth: 560, paddingBottom: 140 }}>
            <div className="form-row">
              <label>认证方式</label>
              <select
                className="select"
                value={req.auth.type}
                onChange={(e) => updateAuth({ type: e.target.value as Auth['type'] })}
              >
                <option value="inherit">继承文件夹认证</option>
                <option value="none">无认证</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">Basic 认证</option>
                <option value="apikey">API Key</option>
              </select>
            </div>

            {req.auth.type === 'inherit' && (
              <div className="card" style={{ marginTop: 8 }}>
                {effectiveAuth.inheritedFrom ? (
                  <div style={{ fontSize: 12.5 }}>
                    当前继承自文件夹 <strong>{effectiveAuth.inheritedFrom}</strong> 的{' '}
                    <span className="pill pill-accent">{effectiveAuth.auth.type.toUpperCase()}</span> 认证。
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>上级文件夹未设置公共认证，当前不附加认证头。</div>
                )}
              </div>
            )}

            {req.auth.type === 'bearer' && (
              <>
                <div className="form-row">
                  <label>令牌 Token（可直接输入，或下拉选择已有密钥 / 变量）</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <TemplateInput
                      value={req.auth.token ?? ''}
                      onChange={(v) => updateAuth({ token: v })}
                      vars={vars}
                      placeholder="sk-… 或 {{api_key}}"
                      bordered
                      showVarPicker
                      varPickerLabel="选择密钥"
                      varPickerActions={authVarPickerActions}
                    />
                    {req.auth.token && !req.auth.token.includes('{{') && (
                      <button
                        className="btn btn-soft"
                        onClick={extractTokenToSecret}
                        title="把明文令牌提取为密钥变量并收纳进目录"
                      >
                        <IconKey size={13} />
                        收纳为密钥
                      </button>
                    )}
                  </div>
                </div>
                <div className="form-row">
                  <label>前缀</label>
                  <input
                    className="input mono"
                    value={req.auth.prefix ?? 'Bearer'}
                    onChange={(e) => updateAuth({ prefix: e.target.value })}
                  />
                </div>
              </>
            )}

            {req.auth.type === 'basic' && (
              <>
                <div className="form-row">
                  <label>用户名</label>
                  <TemplateInput value={req.auth.username ?? ''} onChange={(v) => updateAuth({ username: v })} vars={vars} bordered />
                </div>
                <div className="form-row">
                  <label>密码</label>
                  <TemplateInput
                    value={req.auth.password ?? ''}
                    onChange={(v) => updateAuth({ password: v })}
                    vars={vars}
                    bordered
                    showVarPicker
                    varPickerLabel="选择密钥"
                    varPickerActions={authVarPickerActions}
                  />
                </div>
              </>
            )}

            {req.auth.type === 'apikey' && (
              <>
                <div className="form-row">
                  <label>键名</label>
                  <input
                    className="input mono"
                    value={req.auth.key ?? ''}
                    placeholder="例如 x-api-key"
                    onChange={(e) => updateAuth({ key: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <label>值</label>
                  <TemplateInput
                    value={req.auth.value ?? ''}
                    onChange={(v) => updateAuth({ value: v })}
                    vars={vars}
                    bordered
                    showVarPicker
                    varPickerLabel="选择密钥"
                    varPickerActions={authVarPickerActions}
                  />
                </div>
                <div className="form-row">
                  <label>传递位置</label>
                  <select className="select" value={req.auth.in ?? 'header'} onChange={(e) => updateAuth({ in: e.target.value as 'header' | 'query' })}>
                    <option value="header">请求头 (Header)</option>
                    <option value="query">查询参数 (Query)</option>
                  </select>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'doc' && (
          <>
            <div className="sub-toolbar">
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                接口归档文档（导入 cURL 时自动生成，密钥已脱敏）
              </span>
              <div className="segmented">
                <button className={!editingDoc ? 'active' : ''} onClick={() => setEditingDoc(false)}>
                  预览
                </button>
                <button className={editingDoc ? 'active' : ''} onClick={() => setEditingDoc(true)}>
                  编辑 Markdown
                </button>
              </div>
            </div>
            <div className="tab-scroll">
              {editingDoc ? (
                <textarea
                  className="textarea mono"
                  style={{ width: '100%', minHeight: 300 }}
                  placeholder="编写该接口的说明文档、参数注释、注意事项…"
                  value={req.description ?? ''}
                  onChange={(e) => updateRequest(req.id, { description: e.target.value })}
                />
              ) : req.description?.trim() ? (
                <MarkdownView content={req.description} />
              ) : (
                <div className="empty-state">
                  <p>暂无文档。通过「粘贴 cURL」归档的接口会自动生成脱敏文档，也可以切换到「编辑 Markdown」手动撰写。</p>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'settings' && (
          <div className="tab-scroll" style={{ maxWidth: 520 }}>
            <div className="form-row">
              <label>默认响应筛选表达式（jq / JSONPath）</label>
              <input
                className="input mono"
                placeholder="例如 .choices[0].message.content // .error.message // ."
                value={req.responseFilter ?? ''}
                onChange={(e) => updateRequest(req.id, { responseFilter: e.target.value })}
              />
            </div>

            <div className="switch-row">
              <div>
                <div>跟随重定向</div>
                <small>留空时沿用全局设置（当前全局：{data.settings.followRedirects ? '开启' : '关闭'}）</small>
              </div>
              <select
                className="select select-sm"
                value={req.settings.followRedirects === undefined ? 'global' : req.settings.followRedirects ? 'yes' : 'no'}
                onChange={(e) =>
                  updateRequest(req.id, {
                    settings: {
                      ...req.settings,
                      followRedirects: e.target.value === 'global' ? undefined : e.target.value === 'yes',
                    },
                  })
                }
              >
                <option value="global">沿用全局</option>
                <option value="yes">开启</option>
                <option value="no">关闭</option>
              </select>
            </div>

            <div className="switch-row">
              <div>
                <div>校验 SSL 证书</div>
                <small>若接口使用自签名证书（相当于 curl -k）可关闭</small>
              </div>
              <select
                className="select select-sm"
                value={req.settings.verifySSL === undefined ? 'global' : req.settings.verifySSL ? 'yes' : 'no'}
                onChange={(e) =>
                  updateRequest(req.id, {
                    settings: {
                      ...req.settings,
                      verifySSL: e.target.value === 'global' ? undefined : e.target.value === 'yes',
                    },
                  })
                }
              >
                <option value="global">沿用全局</option>
                <option value="yes">开启</option>
                <option value="no">关闭 (-k)</option>
              </select>
            </div>

            <div className="switch-row">
              <div>
                <div>超时时间（毫秒）</div>
                <small>留空使用全局默认（{data.settings.timeoutMs} ms）</small>
              </div>
              <input
                className="input input-sm mono"
                style={{ width: 120 }}
                type="number"
                placeholder={String(data.settings.timeoutMs)}
                value={req.settings.timeoutMs ?? ''}
                onChange={(e) =>
                  updateRequest(req.id, {
                    settings: {
                      ...req.settings,
                      timeoutMs: e.target.value ? Number(e.target.value) : undefined,
                    },
                  })
                }
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
