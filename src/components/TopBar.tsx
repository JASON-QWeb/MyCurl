import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
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
    setEnvModal,
    setSettingsModal,
    setCommandPalette,
    setDocModal,
    updateSettings,
    confirm,
    prompt,
  } = useAppStore();

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
        <div className="brand" title="MyCurl — 中文本地优先 API 调试与 cURL 归档工具">
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
              title="切换或新建工作区"
            >
              <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeWs.name}</span>
              <IconChevronDown size={13} />
            </button>
            {openMenu === 'ws' && (
              <div className="menu-pop" style={{ minWidth: 230 }}>
                <div className="menu-title">工作区</div>
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
                        title="删除工作区"
                        onClick={async (e) => {
                          e.stopPropagation();
                          setOpenMenu(null);
                          const ok = await confirm({
                            title: '删除工作区',
                            message: `确定删除工作区「${w.name}」及其中的所有目录、请求和环境变量吗？此操作无法撤销。`,
                            confirmLabel: '删除',
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
                    placeholder="新建工作区名称…"
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
                      title: '重命名工作区',
                      defaultValue: activeWs.name,
                      placeholder: '输入新的工作区名称…',
                      confirmLabel: '保存',
                    });
                    if (next?.trim()) renameWorkspace(activeWs.id, next.trim());
                  }}
                >
                  <span>重命名当前工作区…</span>
                </button>
              </div>
            )}
          </div>

          {/* 环境切换 */}
          <div className="dropdown-wrap">
            <button
              className="btn btn-ghost"
              onClick={() => setOpenMenu(openMenu === 'env' ? null : 'env')}
              title="切换运行环境（控制开发/测试/生产等子环境变量覆盖）"
            >
              <span className="env-dot" style={{ background: activeEnv?.color ?? 'var(--text-muted)' }} />
              <span>{activeEnv ? activeEnv.name : '仅全局变量'}</span>
              <IconChevronDown size={13} />
            </button>
            {openMenu === 'env' && (
              <div className="menu-pop" style={{ minWidth: 235 }}>
                <div className="menu-title">运行环境</div>
                <button
                  className={`menu-item ${activeEnvId === null ? 'active' : ''}`}
                  onClick={() => {
                    setActiveEnvironment(null);
                    setOpenMenu(null);
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span className="env-dot" style={{ background: 'var(--text-muted)' }} />
                    仅全局变量
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
                  变量优先级：全局变量 &lt; 当前环境 &lt; 文件夹变量
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
                    管理环境与密钥库…
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
                openImportModal(clipboardCurl);
                dismissClipboardCurl();
              }}
              title="点击预览并自动归档剪贴板中的 cURL"
            >
              <IconClipboard size={13} />
              <span>检测到 cURL，点击一键归档</span>
            </button>
            <button className="chip-close" onClick={dismissClipboardCurl} title="忽略">
              <IconX size={12} />
            </button>
          </div>
        )}

        {/* 主功能入口：粘贴 AI cURL */}
        <button
          className="btn btn-soft"
          onClick={() => openImportModal()}
          title="粘贴 AI 给出的 cURL 命令，自动收纳密钥、路由、请求体与 jq 筛选 (⌘I / ⌘⇧V)"
        >
          <IconSparkles size={14} />
          <span>粘贴 cURL 智能归档</span>
          <span className="kbd">⌘I</span>
        </button>

        {/* 命令面板 */}
        <button className="btn btn-ghost" onClick={() => setCommandPalette(true)} title="快速跳转或搜索命令 (⌘K)">
          <IconSearch size={14} />
          <span className="kbd">⌘K</span>
        </button>
      </div>

      <div className="topbar-right">
        {saving && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>保存中…</span>}

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setEnvModal(true)}
          title="环境变量与密钥库"
        >
          <IconLayers size={15} />
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setDocModal({ scope: 'workspace' })}
          title="查看 / 导出工作区 API 归档文档"
        >
          <IconDoc size={15} />
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={toggleLayout}
          title={data.settings.layout === 'horizontal' ? '切换为上下布局' : '切换为左右布局'}
        >
          {data.settings.layout === 'horizontal' ? <IconSplit size={15} /> : <IconSplitVert size={15} />}
        </button>

        <button className="btn btn-ghost btn-icon" onClick={toggleTheme} title={isDark ? '切换浅色主题' : '切换深色主题'}>
          {isDark ? <IconSun size={15} /> : <IconMoon size={15} />}
        </button>

        <button className="btn btn-ghost btn-icon" onClick={() => setSettingsModal(true)} title="设置与导入导出">
          <IconSettings size={15} />
        </button>
      </div>
    </header>
  );
};
