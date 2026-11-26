import React, { useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Variable } from '../lib/types';
import { copyText, maskSecret, uid } from '../lib/util';
import { useI18n } from '../lib/i18n';
import { IconCopy, IconEye, IconEyeOff, IconFolder, IconKey, IconLayers, IconPlus, IconTrash, IconUpload, IconX } from './Icons';

const COLORS = ['#22c55e', '#6366f1', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

export const EnvModal: React.FC = () => {
  const {
    data,
    envModal,
    setEnvModal,
    createEnvironment,
    importPostmanEnvironment,
    updateEnvironment,
    deleteEnvironment,
    selectFolder,
    toast,
  } = useAppStore();
  const { lang, t } = useI18n();

  const wsId = data.settings.activeWorkspaceId || data.workspaces[0].id;
  const envs = useMemo(() => data.environments.filter((e) => e.workspaceId === wsId), [data.environments, wsId]);
  const baseEnv = envs.find((e) => e.isBase) ?? envs[0];
  const [selectedId, setSelectedId] = useState<string>('__vault__');
  const [newName, setNewName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  // 汇总所有文件夹 + 环境中的密钥
  const allSecrets = useMemo(() => {
    const list: {
      id: string;
      key: string;
      value: string;
      scope: string;
      folderId?: string;
      note?: string;
    }[] = [];
    for (const e of envs) {
      for (const v of e.variables) {
        if (v.secret) {
          list.push({
            id: v.id,
            key: v.key,
            value: v.value,
            scope: e.isBase ? t('全局变量', 'Global') : t(`环境：${e.name}`, `Env: ${e.name}`),
            note: v.note,
          });
        }
      }
    }
    for (const f of data.folders.filter((x) => x.workspaceId === wsId)) {
      for (const v of f.variables) {
        if (v.secret) {
          list.push({
            id: v.id,
            key: v.key,
            value: v.value,
            scope: t(`目录：${f.name}`, `Folder: ${f.name}`),
            folderId: f.id,
            note: v.note,
          });
        }
      }
    }
    return list;
  }, [envs, data.folders, wsId, lang]);

  if (!envModal) return null;

  const activeEnv = envs.find((e) => e.id === selectedId) ?? (selectedId === '__vault__' ? null : baseEnv);

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const env = importPostmanEnvironment(JSON.parse(await file.text()), wsId);
      if (env) setSelectedId(env.id);
    } catch {
      toast(t('无法读取环境 JSON 文件', 'Could not read the environment JSON file'), 'error');
    }
  };

  const updateVar = (envId: string, varId: string, patch: Partial<Variable>) => {
    const env = envs.find((e) => e.id === envId);
    if (!env) return;
    updateEnvironment(envId, {
      variables: env.variables.map((v) => (v.id === varId ? { ...v, ...patch } : v)),
    });
  };

  const addVar = (envId: string, secret = false) => {
    const env = envs.find((e) => e.id === envId);
    if (!env) return;
    updateEnvironment(envId, {
      variables: [...env.variables, { id: uid('kv_'), key: '', value: '', enabled: true, secret }],
    });
  };

  const removeVar = (envId: string, varId: string) => {
    const env = envs.find((e) => e.id === envId);
    if (!env) return;
    updateEnvironment(envId, { variables: env.variables.filter((v) => v.id !== varId) });
  };

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setEnvModal(false);
      }}
    >
      <div className="modal modal-lg">
        <div className="modal-head">
          <h2>
            <IconLayers size={16} />
            {t('环境变量与密钥库', 'Environments & Secrets')}
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={() => setEnvModal(false)}>
            <IconX size={16} />
          </button>
        </div>

        <div style={{ display: 'flex', flex: 1, minHeight: 420, overflow: 'hidden' }}>
          {/* 左侧列表 */}
          <div style={{ width: 215, borderRight: '1px solid var(--border)', padding: 8, display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-panel)' }}>
            <button
              className={`menu-item ${selectedId === '__vault__' ? 'active' : ''}`}
              onClick={() => setSelectedId('__vault__')}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <IconKey size={13} />
                {t('密钥总览', 'Secrets Vault')}
              </span>
              <span className="pill pill-warning">{allSecrets.length}</span>
            </button>

            <div className="menu-sep" />
            <div className="menu-title">{t('环境列表', 'Environments')}</div>

            <div style={{ display: 'grid', gap: 4, minHeight: 0, overflowY: 'auto' }}>
              {envs.map((e) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <button
                    className={`menu-item ${activeEnv?.id === e.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(e.id)}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, overflow: 'hidden' }}>
                      <span className="env-dot" style={{ background: e.isBase ? 'var(--text-muted)' : e.color || 'var(--accent)' }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.variables.length}</span>
                  </button>
                  {!e.isBase && (
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => {
                        deleteEnvironment(e.id);
                        if (selectedId === e.id) setSelectedId('__vault__');
                      }}
                      title={t('删除环境', 'Delete environment')}
                    >
                      <IconTrash size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={e => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                void importFile(file);
              }}
            />
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 'auto', alignSelf: 'flex-start' }}
              onClick={() => fileInput.current?.click()}
            >
              <IconUpload size={12} />
              {t('导入环境', 'Import Env')}
            </button>
            <div style={{ paddingTop: 8, borderTop: '1px solid var(--border)', display: 'flex', gap: 4 }}>
              <input
                className="input input-sm"
                style={{ flex: 1, minWidth: 0 }}
                placeholder={t('新建子环境…', 'New environment…')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newName.trim()) {
                    const created = createEnvironment(newName, COLORS[envs.length % COLORS.length]);
                    setSelectedId(created.id);
                    setNewName('');
                  }
                }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (!newName.trim()) return;
                  const created = createEnvironment(newName, COLORS[envs.length % COLORS.length]);
                  setSelectedId(created.id);
                  setNewName('');
                }}
              >
                <IconPlus size={12} />
              </button>
            </div>
          </div>

          {/* 右侧内容 */}
          <div style={{ flex: 1, padding: 14, overflowY: 'auto' }}>
            {selectedId === '__vault__' ? (
              <div>
                <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>{t('工作区密钥总览', 'Workspace Secrets Vault')}</h3>
                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-dim)' }}>
                  {t(
                    '汇总所有从 AI cURL 自动收纳到各站点文件夹与环境中的 API Key / Token。所有密钥仅保存在本地硬盘。',
                    'All API keys and tokens extracted across folders and environments. Stored locally on your machine only.',
                  )}
                </p>
                {allSecrets.length === 0 ? (
                  <div className="empty-state">
                    <IconKey size={24} />
                    <p>
                      {t(
                        '还没有收纳任何密钥。粘贴一条包含 Bearer Token 或 API Key 的 cURL 即可自动入库。',
                        'No secrets stored yet. Paste a cURL command containing a Bearer Token or API Key to extract it automatically.',
                      )}
                    </p>
                  </div>
                ) : (
                  <table className="kv-table">
                    <thead>
                      <tr>
                        <th>{t('变量名', 'Variable')}</th>
                        <th>{t('所属位置', 'Scope')}</th>
                        <th>{t('密钥值', 'Value')}</th>
                        <th style={{ width: 90 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {allSecrets.map((s) => {
                        const show = !!revealed[s.id];
                        return (
                          <tr key={s.id}>
                            <td className="mono" style={{ color: 'var(--var-secret-fg)', fontSize: 12 }}>
                              {`{{${s.key}}}`}
                            </td>
                            <td>
                              {s.folderId ? (
                                <button
                                  className="crumb-btn"
                                  onClick={() => {
                                    selectFolder(s.folderId!);
                                    setEnvModal(false);
                                  }}
                                >
                                  <IconFolder size={11} />
                                  {s.scope}
                                </button>
                              ) : (
                                <span className="pill">{s.scope}</span>
                              )}
                            </td>
                            <td className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                              {s.value ? (show ? s.value : maskSecret(s.value)) : <span style={{ color: 'var(--warning)' }}>{t('（未填写）', '(empty)')}</span>}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  onClick={() => setRevealed((r) => ({ ...r, [s.id]: !r[s.id] }))}
                                  title={show ? t('隐藏', 'Hide') : t('显示明文', 'Reveal')}
                                >
                                  {show ? <IconEyeOff size={13} /> : <IconEye size={13} />}
                                </button>
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  onClick={() => {
                                    copyText(s.value);
                                    toast(t(`已复制密钥 ${s.key}`, `Copied secret ${s.key}`), 'success');
                                  }}
                                  title={t('复制密钥', 'Copy secret')}
                                >
                                  <IconCopy size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ) : (
              activeEnv && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {activeEnv.isBase ? (
                        <strong style={{ fontSize: 14 }}>{t('全局变量（始终生效）', 'Global Variables (Always Active)')}</strong>
                      ) : (
                        <>
                          <input
                            className="input input-sm"
                            style={{ fontWeight: 600 }}
                            value={activeEnv.name}
                            onChange={(e) => updateEnvironment(activeEnv.id, { name: e.target.value })}
                          />
                          <div style={{ display: 'flex', gap: 4 }}>
                            {COLORS.map((c) => (
                              <button
                                key={c}
                                style={{
                                  width: 16,
                                  height: 16,
                                  borderRadius: '50%',
                                  background: c,
                                  border: activeEnv.color === c ? '2px solid var(--text)' : '2px solid transparent',
                                }}
                                onClick={() => updateEnvironment(activeEnv.id, { color: c })}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-dim)' }}>
                    {t('变量优先级：全局变量 < 当前激活子环境 < 文件夹变量。', 'Priority: Global < Active Environment < Folder Variables.')}
                  </p>
                  <table className="kv-table">
                    <thead>
                      <tr>
                        <th className="kv-check" />
                        <th style={{ width: '28%' }}>{t('变量名', 'Name')}</th>
                        <th>{t('值', 'Value')}</th>
                        <th style={{ width: 54, textAlign: 'center' }}>{t('密钥', 'Secret')}</th>
                        <th style={{ width: 64 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {activeEnv.variables.map((v) => {
                        const show = !v.secret || !!revealed[v.id];
                        return (
                          <tr key={v.id} className={`kv-row ${v.enabled ? '' : 'disabled'}`}>
                            <td className="kv-check">
                              <input
                                type="checkbox"
                                checked={v.enabled}
                                onChange={(e) => updateVar(activeEnv.id, v.id, { enabled: e.target.checked })}
                              />
                            </td>
                            <td>
                              <input
                                className="input input-sm mono"
                                style={{ width: '100%' }}
                                value={v.key}
                                placeholder={t('如 OPENAI_API_KEY', 'e.g. OPENAI_API_KEY')}
                                onChange={(e) => updateVar(activeEnv.id, v.id, { key: e.target.value })}
                              />
                            </td>
                            <td>
                              <input
                                className="input input-sm mono"
                                style={{ width: '100%' }}
                                type={show ? 'text' : 'password'}
                                value={v.value}
                                placeholder={t('变量值', 'Value')}
                                onChange={(e) => updateVar(activeEnv.id, v.id, { value: e.target.value })}
                              />
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={!!v.secret}
                                onChange={(e) => updateVar(activeEnv.id, v.id, { secret: e.target.checked })}
                                style={{ accentColor: 'var(--warning)' }}
                              />
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                                {v.secret && (
                                  <button
                                    className="btn btn-ghost btn-icon btn-sm"
                                    onClick={() => setRevealed((r) => ({ ...r, [v.id]: !r[v.id] }))}
                                  >
                                    {show ? <IconEyeOff size={13} /> : <IconEye size={13} />}
                                  </button>
                                )}
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  onClick={() => removeVar(activeEnv.id, v.id)}
                                >
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
                    <button className="btn btn-sm" onClick={() => addVar(activeEnv.id, false)}>
                      <IconPlus size={13} />
                      {t('添加变量', 'Add Variable')}
                    </button>
                    <button className="btn btn-sm" onClick={() => addVar(activeEnv.id, true)}>
                      <IconKey size={13} />
                      {t('添加密钥', 'Add Secret')}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
