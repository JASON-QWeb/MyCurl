import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Auth, Folder, Variable } from '../lib/types';
import { resolveVariables } from '../lib/template';
import { copyText, maskSecret, methodColor, methodShort, uid } from '../lib/util';
import { useI18n } from '../lib/i18n';
import { KeyValueTable } from './KeyValueTable';
import { TemplateInput } from './TemplateInput';
import { MarkdownView } from './MarkdownView';
import {
  IconCopy,
  IconDoc,
  IconEye,
  IconEyeOff,
  IconGlobe,
  IconKey,
  IconPlus,
  IconTrash,
} from './Icons';

export const FolderView: React.FC<{ folder: Folder }> = ({ folder }) => {
  const { data, selection, updateFolder, deleteFolder, createRequest, selectRequest, setDocModal, setEnvModal, confirm, toast } = useAppStore();
  const { lang, t } = useI18n();
  const initialTab = selection?.kind === 'folder' && selection.id === folder.id && selection.tab ? selection.tab : 'overview';
  const [tab, setTab] = useState<'overview' | 'vars' | 'auth' | 'headers'>(initialTab);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [editingDoc, setEditingDoc] = useState(false);

  useEffect(() => {
    if (selection?.kind === 'folder' && selection.id === folder.id && selection.tab) {
      setTab(selection.tab);
    }
  }, [selection, folder.id]);

  const authVarPickerActions = useMemo(
    () => [
      { label: t('编辑当前文件夹变量与密钥…', 'Edit folder variables & secrets…'), onClick: () => setTab('vars') },
      { label: t('打开环境变量与密钥库…', 'Open Environments & Secrets…'), onClick: () => setEnvModal(true) },
    ],
    [setEnvModal, lang],
  );

  const vars = useMemo(() => resolveVariables(data, folder.workspaceId, folder.id), [data, folder.workspaceId, folder.id]);
  const childRequests = useMemo(
    () => data.requests.filter((r) => r.folderId === folder.id).sort((a, b) => a.sortOrder - b.sortOrder),
    [data.requests, folder.id],
  );

  const updateVar = (id: string, patch: Partial<Variable>) => {
    updateFolder(folder.id, {
      variables: folder.variables.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });
  };

  const addVar = (secret = false) => {
    const next: Variable = { id: uid('kv_'), key: secret ? 'api_key' : '', value: '', enabled: true, secret };
    updateFolder(folder.id, { variables: [...folder.variables, next] });
  };

  const removeVar = (id: string) => {
    updateFolder(folder.id, { variables: folder.variables.filter((v) => v.id !== id) });
  };

  const updateAuth = (patch: Partial<Auth>) => {
    updateFolder(folder.id, { auth: { ...folder.auth, ...patch } });
  };

  const secrets = folder.variables.filter((v) => v.secret);
  const normalVars = folder.variables.filter((v) => !v.secret);

  return (
    <div className="folder-view">
      <div className="folder-hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              background: 'var(--accent-soft)',
              color: 'var(--var-fg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <IconGlobe size={18} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <input
              className="req-name-input"
              style={{ fontSize: 16, width: '100%', padding: '1px 4px' }}
              value={folder.name}
              onChange={(e) => updateFolder(folder.id, { name: e.target.value })}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2, paddingLeft: 4 }}>
              {folder.host && <span className="pill pill-accent mono">{folder.host}</span>}
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {t(
                  `${childRequests.length} 个接口 · ${folder.variables.length} 个变量（含 ${secrets.length} 个密钥）`,
                  `${childRequests.length} requests · ${folder.variables.length} variables (${secrets.length} secrets)`,
                )}
              </span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="btn btn-ghost"
            style={{ color: 'var(--danger)' }}
            title={t('删除文件夹', 'Delete folder')}
            onClick={async () => {
              const ok = await confirm({
                title: t('删除文件夹', 'Delete Folder'),
                message: t(
                  `确定删除文件夹「${folder.name}」及其中的所有子目录和请求吗？此操作无法撤销。`,
                  `Delete folder "${folder.name}" and all its subfolders and requests? This cannot be undone.`,
                ),
                confirmLabel: t('删除', 'Delete'),
                danger: true,
              });
              if (ok) deleteFolder(folder.id);
            }}
          >
            <IconTrash size={14} />
            {t('删除', 'Delete')}
          </button>
          <button className="btn" onClick={() => setDocModal({ scope: 'folder', folderId: folder.id })}>
            <IconDoc size={14} />
            {t('导出 Markdown 文档', 'Export Markdown')}
          </button>
          <button className="btn btn-primary" onClick={() => createRequest(folder.id)}>
            <IconPlus size={14} />
            {t('新建请求', 'New Request')}
          </button>
        </div>
      </div>

      <div className="tabs-bar">
        <div className="tabs-list">
          <button className={`tab-btn ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
            {t('归档概览与文档', 'Overview & Docs')}
          </button>
          <button className={`tab-btn ${tab === 'vars' ? 'active' : ''}`} onClick={() => setTab('vars')}>
            {t('变量与密钥', 'Variables & Secrets')}
            {folder.variables.length > 0 && <span className="tab-count">{folder.variables.length}</span>}
          </button>
          <button className={`tab-btn ${tab === 'auth' ? 'active' : ''}`} onClick={() => setTab('auth')}>
            {t('公共认证', 'Shared Auth')}
            {folder.auth.type !== 'inherit' && folder.auth.type !== 'none' && <span className="tab-dot" />}
          </button>
          <button className={`tab-btn ${tab === 'headers' ? 'active' : ''}`} onClick={() => setTab('headers')}>
            {t('公共请求头', 'Shared Headers')}
            {folder.headers.filter((h) => h.enabled).length > 0 && (
              <span className="tab-count">{folder.headers.filter((h) => h.enabled).length}</span>
            )}
          </button>
        </div>
      </div>

      <div className="tab-scroll" style={{ padding: '14px 18px 28px' }}>
        {tab === 'overview' && (
          <div>
            <div className="card-grid">
              {/* 收纳的路由地址 */}
              <div className="card">
                <div className="card-title">
                  <span>{t('路由前缀 / 普通变量', 'Base URLs / Variables')}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setTab('vars')}>
                    {t('管理', 'Manage')}
                  </button>
                </div>
                {normalVars.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('暂无路由变量', 'No variables yet')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {normalVars.map((v) => (
                      <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <code style={{ color: 'var(--var-fg)', fontSize: 12 }}>{`{{${v.key}}}`}</code>
                        <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {v.value}
                        </span>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title={t('复制值', 'Copy value')}
                          onClick={() => {
                            copyText(v.value);
                            toast(t(`已复制 ${v.key}`, `Copied ${v.key}`), 'success');
                          }}
                        >
                          <IconCopy size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 收纳的密钥 */}
              <div className="card">
                <div className="card-title">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <IconKey size={13} />
                    {t('收纳的密钥', 'Stored Secrets')}
                  </span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setTab('vars')}>
                    {t('管理', 'Manage')}
                  </button>
                </div>
                {secrets.length === 0 ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('暂无密钥变量', 'No secrets yet')}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {secrets.map((v) => {
                      const show = !!revealed[v.id];
                      return (
                        <div key={v.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <code style={{ color: 'var(--var-secret-fg)', fontSize: 12 }}>{`{{${v.key}}}`}</code>
                          <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: 'right' }}>
                            {show ? v.value : maskSecret(v.value)}
                          </span>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => setRevealed((r) => ({ ...r, [v.id]: !r[v.id] }))}
                            title={show ? t('隐藏', 'Hide') : t('显示明文', 'Reveal')}
                          >
                            {show ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                          </button>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => {
                              copyText(v.value);
                              toast(t(`已复制密钥 ${v.key}`, `Copied secret ${v.key}`), 'success');
                            }}
                            title={t('复制密钥', 'Copy secret')}
                          >
                            <IconCopy size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 接口一览 */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">
                <span>{t(`已归档接口（${childRequests.length}）`, `Requests (${childRequests.length})`)}</span>
              </div>
              {childRequests.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('此目录还没有接口', 'No requests in this folder yet')}</div>
              ) : (
                <div className="route-list">
                  {childRequests.map((r) => (
                    <div key={r.id} className="route-item" onClick={() => selectRequest(r.id)}>
                      <span className="method-tag" style={{ color: methodColor(r.method) }}>
                        {methodShort(r.method)}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 500 }}>{r.name}</div>
                        <div className="route-url">{r.url}</div>
                      </div>
                      {r.responseFilter && (
                        <span className="pill pill-info mono" title={`jq: ${r.responseFilter}`}>
                          jq
                        </span>
                      )}
                      {r.body.type !== 'none' && <span className="pill">{r.body.type.toUpperCase()}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 文件夹文档 */}
            <div className="card">
              <div className="card-title">
                <span>{t('目录文档（Markdown）', 'Folder Documentation (Markdown)')}</span>
                <button className="btn btn-sm" onClick={() => setEditingDoc(!editingDoc)}>
                  {editingDoc ? t('预览', 'Preview') : t('编辑', 'Edit')}
                </button>
              </div>
              {editingDoc ? (
                <textarea
                  className="textarea mono"
                  rows={8}
                  style={{ width: '100%' }}
                  placeholder={t('在这里记录该服务的接入说明、限流规则、文档链接等…', 'Document setup notes, rate limits, API links…')}
                  value={folder.description ?? ''}
                  onChange={(e) => updateFolder(folder.id, { description: e.target.value })}
                />
              ) : folder.description?.trim() ? (
                <MarkdownView content={folder.description} />
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {t('暂无文档，点击右上角「编辑」补充说明。', 'No documentation yet. Click "Edit" to add notes.')}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'vars' && (
          <div>
            <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12 }}>
              {t(
                '文件夹变量仅作用于此目录及其子目录内的请求，优先级高于全局与子环境。勾选「密钥」后默认遮罩显示，导出文档时也会自动脱敏。',
                'Folder variables apply to requests in this folder and subfolders, overriding global and environment variables. Secrets are masked by default and in exported docs.',
              )}
            </p>
            <table className="kv-table">
              <thead>
                <tr>
                  <th className="kv-check" />
                  <th style={{ width: '24%' }}>{t('变量名', 'Name')}</th>
                  <th>{t('值', 'Value')}</th>
                  <th style={{ width: 64, textAlign: 'center' }}>{t('密钥', 'Secret')}</th>
                  <th style={{ width: '22%' }}>{t('备注', 'Note')}</th>
                  <th style={{ width: 64 }} />
                </tr>
              </thead>
              <tbody>
                {folder.variables.map((v) => {
                  const show = !v.secret || !!revealed[v.id];
                  return (
                    <tr key={v.id} className={`kv-row ${v.enabled ? '' : 'disabled'}`}>
                      <td className="kv-check">
                        <input
                          type="checkbox"
                          checked={v.enabled}
                          onChange={(e) => updateVar(v.id, { enabled: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          className="input input-sm mono"
                          style={{ width: '100%' }}
                          value={v.key}
                          placeholder={t('如 api_key', 'e.g. api_key')}
                          onChange={(e) => updateVar(v.id, { key: e.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="input input-sm mono"
                          style={{ width: '100%' }}
                          type={show ? 'text' : 'password'}
                          value={v.value}
                          placeholder={t('变量值', 'Value')}
                          onChange={(e) => updateVar(v.id, { value: e.target.value })}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={!!v.secret}
                          onChange={(e) => updateVar(v.id, { secret: e.target.checked })}
                          style={{ accentColor: 'var(--warning)' }}
                        />
                      </td>
                      <td>
                        <input
                          className="input input-sm"
                          style={{ width: '100%' }}
                          value={v.note ?? ''}
                          placeholder={t('说明', 'Note')}
                          onChange={(e) => updateVar(v.id, { note: e.target.value })}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                          {v.secret && (
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              onClick={() => setRevealed((r) => ({ ...r, [v.id]: !r[v.id] }))}
                              title={show ? t('隐藏', 'Hide') : t('显示', 'Reveal')}
                            >
                              {show ? <IconEyeOff size={13} /> : <IconEye size={13} />}
                            </button>
                          )}
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            onClick={() => {
                              copyText(v.value);
                              toast(t('已复制变量值', 'Copied variable value'), 'success');
                            }}
                            title={t('复制值', 'Copy value')}
                          >
                            <IconCopy size={13} />
                          </button>
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeVar(v.id)} title={t('删除', 'Delete')}>
                            <IconTrash size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button className="btn btn-sm" onClick={() => addVar(false)}>
                <IconPlus size={13} />
                {t('添加普通变量', 'Add Variable')}
              </button>
              <button className="btn btn-sm" onClick={() => addVar(true)}>
                <IconKey size={13} />
                {t('添加密钥变量', 'Add Secret')}
              </button>
            </div>
          </div>
        )}

        {tab === 'auth' && (
          <div style={{ maxWidth: 520 }}>
            <p style={{ margin: '0 0 12px', color: 'var(--text-dim)', fontSize: 12 }}>
              {t(
                '文件夹内认证方式为「继承」的请求会自动使用这里的认证配置。',
                'Requests in this folder set to "Inherit" will use this authentication config.',
              )}
            </p>
            <div className="form-row">
              <label>{t('认证方式', 'Auth Type')}</label>
              <select
                className="select"
                value={folder.auth.type}
                onChange={(e) => updateAuth({ type: e.target.value as Auth['type'] })}
              >
                <option value="inherit">{t('继承上级', 'Inherit from Parent')}</option>
                <option value="none">{t('无认证', 'No Auth')}</option>
                <option value="bearer">Bearer Token</option>
                <option value="basic">{t('Basic 认证', 'Basic Auth')}</option>
                <option value="apikey">API Key</option>
              </select>
            </div>
            {folder.auth.type === 'bearer' && (
              <>
                <div className="form-row">
                  <label>{t('令牌（可直接输入，或下拉选择已有密钥 / 变量）', 'Token (enter directly or pick a secret / variable)')}</label>
                  <TemplateInput
                    value={folder.auth.token ?? ''}
                    onChange={(v) => updateAuth({ token: v })}
                    vars={vars}
                    placeholder="{{api_key}}"
                    bordered
                    showVarPicker
                    varPickerLabel={t('选择密钥', 'Secrets')}
                    varPickerActions={authVarPickerActions}
                  />
                </div>
                <div className="form-row">
                  <label>{t('前缀', 'Prefix')}</label>
                  <input
                    className="input mono"
                    value={folder.auth.prefix ?? 'Bearer'}
                    onChange={(e) => updateAuth({ prefix: e.target.value })}
                  />
                </div>
              </>
            )}
            {folder.auth.type === 'basic' && (
              <>
                <div className="form-row">
                  <label>{t('用户名', 'Username')}</label>
                  <TemplateInput value={folder.auth.username ?? ''} onChange={(v) => updateAuth({ username: v })} vars={vars} bordered />
                </div>
                <div className="form-row">
                  <label>{t('密码', 'Password')}</label>
                  <TemplateInput
                    value={folder.auth.password ?? ''}
                    onChange={(v) => updateAuth({ password: v })}
                    vars={vars}
                    bordered
                    showVarPicker
                    varPickerLabel={t('选择密钥', 'Secrets')}
                    varPickerActions={authVarPickerActions}
                  />
                </div>
              </>
            )}
            {folder.auth.type === 'apikey' && (
              <>
                <div className="form-row">
                  <label>{t('参数名 / 请求头名', 'Key Name')}</label>
                  <input
                    className="input mono"
                    value={folder.auth.key ?? ''}
                    placeholder={t('如 x-api-key', 'e.g. x-api-key')}
                    onChange={(e) => updateAuth({ key: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <label>{t('值', 'Value')}</label>
                  <TemplateInput
                    value={folder.auth.value ?? ''}
                    onChange={(v) => updateAuth({ value: v })}
                    vars={vars}
                    bordered
                    showVarPicker
                    varPickerLabel={t('选择密钥', 'Secrets')}
                    varPickerActions={authVarPickerActions}
                  />
                </div>
                <div className="form-row">
                  <label>{t('位置', 'Add to')}</label>
                  <select className="select" value={folder.auth.in ?? 'header'} onChange={(e) => updateAuth({ in: e.target.value as 'header' | 'query' })}>
                    <option value="header">{t('请求头 (Header)', 'Header')}</option>
                    <option value="query">{t('查询参数 (Query)', 'Query Param')}</option>
                  </select>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'headers' && (
          <div>
            <p style={{ margin: '0 0 10px', color: 'var(--text-dim)', fontSize: 12 }}>
              {t(
                '文件夹内的所有请求都会自动附带以下请求头（若请求自身配置了同名头，则以请求自身为准）。',
                'All requests in this folder inherit these headers (request-level headers take precedence).',
              )}
            </p>
            <KeyValueTable
              items={folder.headers}
              onChange={(next) => updateFolder(folder.id, { headers: next })}
              vars={vars}
              keyPlaceholder={t('Header 名称', 'Header name')}
              addLabel={t('添加公共请求头', 'Add Shared Header')}
            />
          </div>
        )}
      </div>
    </div>
  );
};
