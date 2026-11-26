import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { parseCurlCommands } from '../lib/curlParser';
import { planImport, type ImportOverrides } from '../lib/curlImport';
import { readClipboardNative } from '../lib/bridge';
import { maskSecret, methodColor } from '../lib/util';
import { useI18n } from '../lib/i18n';
import {
  IconCheck,
  IconClipboard,
  IconEye,
  IconEyeOff,
  IconFilter,
  IconFolder,
  IconGlobe,
  IconKey,
  IconSend,
  IconSparkles,
  IconX,
} from './Icons';

const SAMPLE_CURL = `curl 'https://api.openai.com/v1/chat/completions' \\
  -H "Authorization: Bearer sk-demo-9f8e7d6c5b4a3210fedcba9876543210" \\
  -H 'Content-Type: application/json' \\
  --data-raw '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ],
    "stream": false
  }' | jq -r '.choices[0].message.content // .error.message // .'`;

export const CurlImportModal: React.FC = () => {
  const {
    data,
    importModal,
    closeImportModal,
    applySingleImport,
    applyBatchImport,
    toast,
  } = useAppStore();
  const { lang, t } = useI18n();

  const [raw, setRaw] = useState(importModal?.initialText ?? '');
  const [extractSecrets, setExtractSecrets] = useState(data.settings.import.extractSecrets);
  const [extractBaseUrl, setExtractBaseUrl] = useState(data.settings.import.extractBaseUrl);
  const [groupByHost, setGroupByHost] = useState(data.settings.import.groupByHost);
  const [overrides, setOverrides] = useState<ImportOverrides>({ target: '__auto__' });
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (importModal?.open) {
      setRaw(importModal.initialText ?? '');
      setOverrides({ target: '__auto__' });
      setRevealed({});
      setTimeout(() => textareaRef.current?.focus(), 40);
    }
  }, [importModal?.open, importModal?.initialText]);

  const wsId = data.settings.activeWorkspaceId || data.workspaces[0].id;
  const wsFolders = useMemo(
    () => data.folders.filter((f) => f.workspaceId === wsId).sort((a, b) => a.name.localeCompare(b.name)),
    [data.folders, wsId],
  );

  const parsedList = useMemo(() => (raw.trim() ? parseCurlCommands(raw, lang) : []), [raw, lang]);
  const opts = useMemo(
    () => ({ extractSecrets, extractBaseUrl, groupByHost }),
    [extractSecrets, extractBaseUrl, groupByHost],
  );

  const singlePlan = useMemo(() => {
    if (parsedList.length !== 1) return null;
    return planImport(parsedList[0], data, wsId, opts, overrides);
  }, [parsedList, data, wsId, opts, overrides]);

  const batchPlans = useMemo(() => {
    if (parsedList.length <= 1) return [];
    return parsedList.map((p) => planImport(p, data, wsId, opts));
  }, [parsedList, data, wsId, opts]);

  if (!importModal?.open) return null;

  const readClipboard = async () => {
    const text = await readClipboardNative();
    if (text) {
      setRaw(text);
      setOverrides({ target: '__auto__' });
    } else {
      toast(
        t('剪贴板为空或未授权读取，请直接在左侧输入框按 ⌘V 粘贴', 'Clipboard is empty or unavailable. Press ⌘V directly in the editor.'),
        'warning',
      );
      textareaRef.current?.focus();
    }
  };

  const commit = (autoSend = false) => {
    if (parsedList.length === 0) return;
    if (parsedList.length === 1 && singlePlan) {
      applySingleImport(singlePlan, autoSend);
    } else {
      applyBatchImport(parsedList, opts, autoSend);
    }
    closeImportModal();
  };

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeImportModal();
      }}
    >
      <div
        className="modal modal-lg"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            commit(false);
          } else if (e.key === 'Escape') {
            closeImportModal();
          }
        }}
      >
        <div className="modal-head">
          <h2>
            <IconSparkles size={16} />
            {t('粘贴 cURL 智能归档', 'Paste cURL to Import')}
            {parsedList.length > 0 && (
              <span className="pill pill-accent">
                {t(`识别到 ${parsedList.length} 条命令`, `${parsedList.length} command${parsedList.length === 1 ? '' : 's'} detected`)}
              </span>
            )}
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={closeImportModal}>
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="import-grid">
            {/* 左侧：粘贴区 + 归档规则 */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
                  {t('粘贴 AI 或浏览器复制的 cURL 指令', 'Paste cURL from AI or Browser DevTools')}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" onClick={readClipboard}>
                    <IconClipboard size={12} />
                    {t('从剪贴板读取', 'Paste Clipboard')}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setRaw(SAMPLE_CURL);
                      setOverrides({ target: '__auto__' });
                    }}
                  >
                    {t('填入示例', 'Sample')}
                  </button>
                </div>
              </div>

              <textarea
                ref={textareaRef}
                className="textarea mono"
                style={{ flex: 1, minHeight: 270, fontSize: 12, lineHeight: 1.55 }}
                placeholder={t(
                  '直接粘贴 AI 给你的完整指令（支持 Markdown 代码块、多行反斜杠、export KEY=...、| jq -r \'...\' 以及一次粘贴多条 curl）',
                  'Paste one or more cURL commands (supports Markdown code fences, multiline backslashes, export KEY=..., and | jq pipes)',
                )}
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setOverrides({ target: '__auto__' });
                }}
              />

              {/* 智能归档开关 */}
              <div className="import-card" style={{ marginBottom: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 6 }}>
                  {t('自动收纳规则', 'Smart Import Rules')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={extractSecrets}
                      onChange={(e) => setExtractSecrets(e.target.checked)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    {t('自动收纳密钥变量', 'Extract secrets')}
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={extractBaseUrl}
                      onChange={(e) => setExtractBaseUrl(e.target.checked)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    {t('提取路由前缀 (base_url)', 'Extract base_url')}
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={groupByHost}
                      onChange={(e) => setGroupByHost(e.target.checked)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    {t('按域名自动建档', 'Group by host')}
                  </label>
                </div>
              </div>
            </div>

            {/* 右侧：智能归档预览 */}
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
              {parsedList.length === 0 ? (
                <div className="empty-state" style={{ border: '1px dashed var(--border)', borderRadius: 10 }}>
                  <IconSparkles size={24} />
                  <h3>{t('等待粘贴 cURL', 'Waiting for cURL')}</h3>
                  <p>
                    {t('自动识别 ', 'Automatically detects ')}
                    <strong>{t('Bearer / API Key 密钥', 'Bearer / API Keys')}</strong>
                    {t('、', ', ')}
                    <strong>{t('域名路由', 'Base URLs')}</strong>
                    {t('、', ', ')}
                    <strong>{t('JSON 请求体', 'JSON bodies')}</strong>
                    {t(' 与管道中的 ', ', and piped ')}
                    <strong>{t('jq 筛选表达式', 'jq filters')}</strong>
                    {t('，收纳到对应目录并自动生成脱敏文档。', ', organizing them into folders with masked docs.')}
                  </p>
                </div>
              ) : singlePlan ? (
                <div>
                  {/* 归档目录与请求名称 */}
                  <div className="import-card">
                    <div className="form-row" style={{ marginBottom: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <IconFolder size={12} />
                        {t('归档目录', 'Target Folder')}
                        {singlePlan.folder.kind === 'new' && (
                          <span className="pill pill-success">{t('将自动新建目录', 'New folder')}</span>
                        )}
                        {singlePlan.folder.kind === 'existing' && (
                          <span className="pill pill-info">{t('归入已有目录', 'Existing folder')}</span>
                        )}
                      </label>
                      <select
                        className="select select-sm"
                        value={overrides.target ?? '__auto__'}
                        onChange={(e) => setOverrides({ ...overrides, target: e.target.value })}
                      >
                        <option value="__auto__">
                          {groupByHost && singlePlan.folder.host
                            ? t(
                                `自动按域名归档 → ${singlePlan.folder.name}${singlePlan.folder.kind === 'new' ? '（新建）' : '（已有）'}`,
                                `Auto by host → ${singlePlan.folder.name} (${singlePlan.folder.kind === 'new' ? 'new' : 'existing'})`,
                              )
                            : t('自动归档 → 根目录', 'Auto → Workspace Root')}
                        </option>
                        <option value="__root__">{t('工作区根目录', 'Workspace Root')}</option>
                        <option value="__new__">{t('+ 自定义新建文件夹…', '+ New Custom Folder…')}</option>
                        {wsFolders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {t(`文件夹：${f.name}`, `Folder: ${f.name}`)}
                          </option>
                        ))}
                      </select>
                      {overrides.target === '__new__' && (
                        <input
                          className="input input-sm"
                          style={{ marginTop: 4 }}
                          placeholder={t('输入新文件夹名称', 'New folder name')}
                          value={overrides.newFolderName ?? ''}
                          onChange={(e) => setOverrides({ ...overrides, newFolderName: e.target.value })}
                        />
                      )}
                    </div>

                    <div className="form-row" style={{ marginBottom: 0 }}>
                      <label>{t('请求名称', 'Request Name')}</label>
                      <input
                        className="input input-sm"
                        value={overrides.name ?? singlePlan.request.name}
                        onChange={(e) => setOverrides({ ...overrides, name: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* 查重提醒 */}
                  {singlePlan.duplicateOf && (
                    <div
                      className="import-card"
                      style={{ borderColor: 'rgba(251, 191, 36, 0.45)', background: 'var(--warning-soft)' }}
                    >
                      <div style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600, marginBottom: 4 }}>
                        {t(
                          `检测到目录中已存在相同请求「${singlePlan.duplicateOf.name}」`,
                          `Identical request "${singlePlan.duplicateOf.name}" already exists`,
                        )}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!overrides.createDuplicate}
                          onChange={(e) => setOverrides({ ...overrides, createDuplicate: e.target.checked })}
                        />
                        {t(
                          '仍作为新请求创建副本（不勾选则直接跳转到已有请求）',
                          'Create a duplicate anyway (unchecked jumps to existing)',
                        )}
                      </label>
                    </div>
                  )}

                  {/* 收纳的变量与密钥 */}
                  {singlePlan.vars.length > 0 && (
                    <div className="import-card">
                      <div className="card-title" style={{ marginBottom: 6 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <IconKey size={13} />
                          {t(
                            `将自动收纳的变量与密钥（${singlePlan.vars.filter((v) => v.enabled).length}）`,
                            `Extracted Variables & Secrets (${singlePlan.vars.filter((v) => v.enabled).length})`,
                          )}
                        </span>
                      </div>
                      {singlePlan.vars.map((v) => {
                        const show = !v.secret || !!revealed[v.slot];
                        return (
                          <div key={v.slot} className="import-var-row">
                            <input
                              type="checkbox"
                              checked={v.enabled}
                              onChange={(e) =>
                                setOverrides({
                                  ...overrides,
                                  varDisabled: { ...overrides.varDisabled, [v.slot]: !e.target.checked },
                                })
                              }
                              style={{ accentColor: 'var(--accent)' }}
                            />
                            <input
                              className="input input-sm mono"
                              style={{ width: '100%', color: v.secret ? 'var(--var-secret-fg)' : 'var(--var-fg)' }}
                              disabled={v.status === 'reuse' || !v.enabled}
                              value={overrides.varNames?.[v.slot] ?? v.key}
                              onChange={(e) =>
                                setOverrides({
                                  ...overrides,
                                  varNames: { ...overrides.varNames, [v.slot]: e.target.value },
                                })
                              }
                            />
                            <div
                              className="mono"
                              style={{
                                fontSize: 11.5,
                                color: 'var(--text-dim)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                              title={v.label}
                            >
                              {v.needsValue ? (
                                <span style={{ color: 'var(--warning)' }}>{t(`待填写（来自 ${v.label}）`, `Needs value (${v.label})`)}</span>
                              ) : show ? (
                                v.value
                              ) : (
                                maskSecret(v.value)
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              {v.secret && v.value && (
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  onClick={() => setRevealed((r) => ({ ...r, [v.slot]: !r[v.slot] }))}
                                  title={show ? t('隐藏', 'Hide') : t('查看明文', 'Reveal')}
                                >
                                  {show ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                                </button>
                              )}
                              <span
                                className={`pill ${
                                  v.status === 'reuse' ? 'pill-info' : v.secret ? 'pill-warning' : 'pill-success'
                                }`}
                              >
                                {v.status === 'reuse'
                                  ? t('复用已有', 'Reuse')
                                  : v.secret
                                    ? t('新建密钥', 'New Secret')
                                    : t('新建', 'New')}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 归档后的路由、认证、请求体、jq 预览 */}
                  <div className="import-card" style={{ marginBottom: 0 }}>
                    <div className="card-title" style={{ marginBottom: 6 }}>
                      <span>{t('归档后的请求预览', 'Request Preview')}</span>
                      {singlePlan.request.responseFilter && (
                        <span className="pill pill-info mono" title={t('将自动填入响应筛选栏', 'Auto-filled into response filter')}>
                          <IconFilter size={10} />
                          {t('jq 已捕获', 'jq captured')}
                        </span>
                      )}
                    </div>
                    <div
                      className="mono"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        background: 'var(--bg-input)',
                        borderRadius: 6,
                        fontSize: 12,
                        wordBreak: 'break-all',
                        marginBottom: 8,
                      }}
                    >
                      <strong style={{ color: methodColor(singlePlan.request.method), flexShrink: 0 }}>
                        {singlePlan.request.method}
                      </strong>
                      <span>{singlePlan.request.url}</span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                      {singlePlan.request.auth.type !== 'none' && (
                        <span className="pill pill-warning mono">
                          <IconKey size={10} />
                          Auth: {singlePlan.request.auth.type} {singlePlan.request.auth.token || singlePlan.request.auth.username}
                        </span>
                      )}
                      {singlePlan.request.headers.map((h) => (
                        <span key={h.id} className="pill mono">
                          {h.key}: {h.value}
                        </span>
                      ))}
                    </div>

                    {singlePlan.request.responseFilter && (
                      <div
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          padding: '5px 8px',
                          background: 'var(--info-soft)',
                          color: 'var(--info)',
                          borderRadius: 6,
                          marginBottom: 8,
                        }}
                      >
                        {t('响应 jq 筛选：', 'Response jq filter: ')}
                        {singlePlan.request.responseFilter}
                      </div>
                    )}

                    {singlePlan.request.body.type !== 'none' && (
                      <pre className="md-pre" style={{ margin: 0, maxHeight: 150, fontSize: 11.5 }}>
                        <code>
                          {singlePlan.request.body.type === 'form'
                            ? singlePlan.request.body.form.map((f) => `${f.key}=${f.value}`).join('\n')
                            : singlePlan.request.body.type === 'multipart'
                              ? singlePlan.request.body.multipart.map((f) => `${f.key}=${f.isFile ? `@${f.fileName}` : f.value}`).join('\n')
                              : singlePlan.request.body.text}
                        </code>
                      </pre>
                    )}

                    {singlePlan.notes.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--warning)' }}>
                        {singlePlan.notes.map((n, i) => (
                          <div key={i}>• {n}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* 多条 cURL 批量预览 */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {t('已识别 ', 'Detected ')}
                    <strong>{batchPlans.length}</strong>
                    {t(' 条 cURL 命令，将依次归档并自动复用同站点的目录与密钥变量：', ' cURL commands. Shared folders and secrets will be reused automatically:')}
                  </div>
                  {batchPlans.map((p, idx) => (
                    <div key={idx} className="import-card" style={{ marginBottom: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <strong className="mono" style={{ color: methodColor(p.request.method), fontSize: 11.5 }}>
                            {p.request.method}
                          </strong>
                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.request.name}
                          </span>
                        </div>
                        <span className="pill">
                          <IconGlobe size={10} />
                          {p.folder.name}
                        </span>
                      </div>
                      <div className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                        {p.request.url}
                      </div>
                      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                        {p.vars
                          .filter((v) => v.enabled)
                          .map((v) => (
                            <span key={v.slot} className={`pill mono ${v.secret ? 'pill-warning' : 'pill-accent'}`}>
                              {`{{${v.key}}}`}
                            </span>
                          ))}
                        {p.request.responseFilter && <span className="pill pill-info mono">jq</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {t('提示：原始命令将自动脱敏后归档进接口文档', 'Tip: Original commands are masked before saving to docs')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={closeImportModal}>
              {t('取消', 'Cancel')}
            </button>
            <button className="btn" disabled={parsedList.length === 0} onClick={() => commit(true)}>
              <IconSend size={13} />
              {t('归档并立即发送', 'Import & Send')}
            </button>
            <button className="btn btn-primary" disabled={parsedList.length === 0} onClick={() => commit(false)}>
              <IconCheck size={14} />
              {parsedList.length > 1
                ? t(`全部归档 (${parsedList.length})`, `Import All (${parsedList.length})`)
                : t('归档并打开', 'Import & Open')}
              <span className="kbd" style={{ color: '#fff', background: 'rgba(255,255,255,0.18)', borderColor: 'transparent' }}>
                ⌘↵
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
