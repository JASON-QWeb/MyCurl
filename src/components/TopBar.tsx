import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useI18n } from '../lib/i18n';
import {
  IconCheck,
  IconChevronDown,
  IconClipboard,
  IconDoc,
  IconLayers,
  IconMoon,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconSplit,
  IconSplitVert,
  IconSun,
  IconTrash,
  IconX,
} from './Icons';

export const TopBar: React.FC = () => {
  const {
    data,
    saving,
    clipboardCurl,
    dismissClipboardCurl,
    setActiveWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setActiveEnvironment,
    openImportModal,
    importPastedCurl,
    setEnvModal,
    setSettingsModal,
    setCommandPalette,
    setDocModal,
    updateSettings,
    confirm,
    prompt,
  } = useAppStore();
  const { t } = useI18n();

  const [openMenu, setOpenMenu] = useState<'ws' | 'env' | null>(null);
  const [newWsName, setNewWsName] = useState('');
  const menusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (menusRef.current && !menusRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openMenu]);

  const wsId = data.settings.activeWorkspaceId || data.workspaces[0].id;
  const activeWs = data.workspaces.find((w) => w.id === wsId) ?? data.workspaces[0];
  const subEnvs = data.environments.filter((e) => e.workspaceId === wsId && !e.isBase);
  const activeEnvId = data.settings.activeEnvironment[wsId] ?? null;
  const activeEnv = subEnvs.find((e) => e.id === activeEnvId) ?? null;

  const isDark =
    data.settings.theme === 'dark' ||
    (data.settings.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const toggleTheme = () => {
    updateSettings({ theme: isDark ? 'light' : 'dark' });
  };

  const toggleLayout = () => {
    updateSettings({ layout: data.settings.layout === 'horizontal' ? 'vertical' : 'horizontal' });
  };

  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="topbar-left">
        <div className="brand" title={t('MyCurl — 本地优先 API 调试与 cURL 归档工具', 'MyCurl — Local-first API Client & cURL Organizer')}>
          <img
            src="./icon.png"
            alt="MyCurl"
            width={22}
            height={22}
            style={{ display: 'block', borderRadius: 5, flexShrink: 0 }}
          />
          <span>MyCurl</span>
        </div>

        <div className="divider-v" />

        <div ref={menusRef} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* 工作区切换 */}
          <div className="dropdown-wrap">
            <button
              className="btn btn-ghost"
              onClick={() => setOpenMenu(openMenu === 'ws' ? null : 'ws')}
              title={t('切换或新建工作区', 'Switch or create workspace')}
            >
              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeWs.name}</span>
              <IconChevronDown size={13} />
            </button>
            {openMenu === 'ws' && (
              <div className="menu-pop" style={{ minWidth: 230 }}>
                <div className="menu-title">{t('工作区', 'Workspaces')}</div>
                {data.workspaces.map((w) => (
                  <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <button
                      className={`menu-item ${w.id === wsId ? 'active' : ''}`}
                      onClick={() => {
                        setActiveWorkspace(w.id);
                        setOpenMenu(null);
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.name}</span>
                      {w.id === wsId && <IconCheck size={13} />}
                    </button>
                    {data.workspaces.length > 1 && (
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        title={t('删除工作区', 'Delete workspace')}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setOpenMenu(null);
                          const ok = await confirm({
                            title: t('删除工作区', 'Delete Workspace'),
                            message: t(
                              `确定删除工作区「${w.name}」及其中的所有目录、请求和环境变量吗？此操作无法撤销。`,
                              `Delete workspace "${w.name}" and all its folders, requests, and variables? This cannot be undone.`,
                            ),
                            confirmLabel: t('删除', 'Delete'),
                            danger: true,
                          });
                          if (ok) deleteWorkspace(w.id);
                        }}
                      >
                        <IconTrash size={12} />
                      </button>
                    )}
                  </div>
                ))}
                <div className="menu-sep" />
                <div style={{ padding: '4px 6px', display: 'flex', gap: 4 }}>
                  <input
                    className="input input-sm"
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder={t('新建工作区名称…', 'New workspace name…')}
                    value={newWsName}
                    onChange={(e) => setNewWsName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newWsName.trim()) {
                        createWorkspace(newWsName);
                        setNewWsName('');
                        setOpenMenu(null);
                      }
                    }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      if (!newWsName.trim()) return;
                      createWorkspace(newWsName);
                      setNewWsName('');
                      setOpenMenu(null);
                    }}
                  >
                    <IconPlus size={12} />
                  </button>
                </div>
                <button
                  className="menu-item"
                  onClick={async () => {
                    setOpenMenu(null);
                    const next = await prompt({
                      title: t('重命名工作区', 'Rename Workspace'),
                      defaultValue: activeWs.name,
                      placeholder: t('输入新的工作区名称…', 'Enter new workspace name…'),
                      confirmLabel: t('保存', 'Save'),
                    });
                    if (next?.trim()) renameWorkspace(activeWs.id, next.trim());
                  }}
                >
                  <span>{t('重命名当前工作区…', 'Rename current workspace…')}</span>
                </button>
              </div>
            )}
          </div>

          {/* 环境切换 */}
          <div className="dropdown-wrap">
            <button
              className="btn btn-ghost"
              onClick={() => setOpenMenu(openMenu === 'env' ? null : 'env')}
              title={t('切换运行环境（控制开发/测试/生产等子环境变量覆盖）', 'Switch active environment')}
            >
              <span className="env-dot" style={{ background: activeEnv?.color ?? 'var(--text-muted)' }} />
              <span>{activeEnv ? activeEnv.name : t('仅全局变量', 'Global Only')}</span>
              <IconChevronDown size={13} />
            </button>
            {openMenu === 'env' && (
              <div className="menu-pop" style={{ minWidth: 235 }}>
                <div className="menu-title">{t('运行环境', 'Environments')}</div>
                <button
                  className={`menu-item ${activeEnvId === null ? 'active' : ''}`}
                  onClick={() => {
                    setActiveEnvironment(null);
                    setOpenMenu(null);
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span className="env-dot" style={{ background: 'var(--text-muted)' }} />
                    {t('仅全局变量', 'Global Only')}
                  </span>
                  {activeEnvId === null && <IconCheck size={13} />}
                </button>
                {subEnvs.map((e) => (
                  <button
                    key={e.id}
                    className={`menu-item ${activeEnvId === e.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveEnvironment(e.id);
                      setOpenMenu(null);
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span className="env-dot" style={{ background: e.color || 'var(--accent)' }} />
                      {e.name}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {e.variables.length > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{e.variables.length}</span>
                      )}
                      {activeEnvId === e.id && <IconCheck size={13} />}
                    </span>
                  </button>
                ))}
                <div className="menu-sep" />
                <div style={{ padding: '4px 8px 6px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  {t('变量优先级：全局变量 < 当前环境 < 文件夹变量', 'Priority: Global < Environment < Folder')}
                </div>
                <button
                  className="menu-item"
                  onClick={() => {
                    setOpenMenu(null);
                    setEnvModal(true);
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <IconLayers size={13} />
                    {t('管理环境与密钥库…', 'Manage Environments & Secrets…')}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="topbar-center">
        {/* 剪贴板实时检测到的 cURL 提示 */}
        {clipboardCurl && (
          <div className="clipboard-chip">
            <button
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: 0,
              }}
              onClick={() => {
                importPastedCurl(clipboardCurl);
                dismissClipboardCurl();
              }}
              title={data.settings.import.skipPreview && data.settings.import.autoSend
                ? t('归档剪贴板中的 cURL 并发送选中的请求', 'Import clipboard cURL and send the selected request')
                : t('归档剪贴板中的 cURL', 'Import cURL from clipboard')}
            >
              <IconClipboard size={13} />
              <span>{t('检测到 cURL，点击一键归档', 'cURL detected — Import')}</span>
            </button>
            <button className="chip-close" onClick={dismissClipboardCurl} title={t('忽略', 'Dismiss')}>
              <IconX size={12} />
            </button>
          </div>
        )}

        {/* 主功能入口：粘贴 AI cURL */}
        <button
          className="btn btn-soft"
          onClick={() => openImportModal()}
          title={t(
            '粘贴 AI 给出的 cURL 命令，自动收纳密钥、路由、请求体与 jq 筛选 (⌘I / ⌘⇧V)',
            'Paste cURL to auto-extract secrets, base URL, body, and jq filter (⌘I / ⌘⇧V)',
          )}
        >
          <IconSparkles size={14} />
          <span>{t('粘贴 cURL 智能归档', 'Import cURL')}</span>
          <span className="kbd">⌘I</span>
        </button>

        {/* 命令面板 */}
        <button className="btn btn-ghost" onClick={() => setCommandPalette(true)} title={t('快速跳转或搜索命令 (⌘K)', 'Command Palette (⌘K)')}>
          <IconSearch size={14} />
          <span className="kbd">⌘K</span>
        </button>
      </div>

      <div className="topbar-right">
        {saving && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('保存中…', 'Saving…')}</span>}

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setEnvModal(true)}
          title={t('环境变量与密钥库', 'Environments & Secrets')}
        >
          <IconLayers size={15} />
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setDocModal({ scope: 'workspace' })}
          title={t('查看 / 导出工作区 API 归档文档', 'Workspace API Docs')}
        >
          <IconDoc size={15} />
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={toggleLayout}
          title={
            data.settings.layout === 'horizontal'
              ? t('切换为上下布局', 'Switch to vertical layout')
              : t('切换为左右布局', 'Switch to horizontal layout')
          }
        >
          {data.settings.layout === 'horizontal' ? <IconSplit size={15} /> : <IconSplitVert size={15} />}
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={toggleTheme}
          title={isDark ? t('切换浅色主题', 'Switch to light theme') : t('切换深色主题', 'Switch to dark theme')}
        >
          {isDark ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>

        <button className="btn btn-ghost btn-icon" onClick={() => setSettingsModal(true)} title={t('设置与导入导出', 'Settings & Data')}>
          <IconSettings size={15} />
        </button>
      </div>
    </header>
  );
};
