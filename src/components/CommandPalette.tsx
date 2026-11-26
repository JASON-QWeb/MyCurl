import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { methodColor, methodShort } from '../lib/util';
import { filterWorkspaceRequests, parseRequestSearch } from '../lib/requestSearch';
import { useI18n } from '../lib/i18n';
import { IconDoc, IconFolder, IconLayers, IconPlus, IconSearch, IconSettings, IconSparkles } from './Icons';

interface PaletteItem {
  id: string;
  label: string;
  sub?: string;
  badge?: string;
  badgeColor?: string;
  icon?: React.ReactNode;
  run: () => void;
}

export const CommandPalette: React.FC = () => {
  const {
    data,
    commandPalette,
    setCommandPalette,
    selectRequest,
    selectFolder,
    createRequest,
    createFolder,
    openImportModal,
    setEnvModal,
    setSettingsModal,
    setDocModal,
  } = useAppStore();
  const { lang, t } = useI18n();

  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (commandPalette) {
      setQuery('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [commandPalette]);

  const wsId = data.settings.activeWorkspaceId || data.workspaces[0].id;

  const items = useMemo(() => {
    const search = parseRequestSearch(query);
    const actions: PaletteItem[] = [
      {
        id: 'act:import',
        label: t('粘贴 cURL 智能归档', 'Paste cURL to Import'),
        sub: t('自动提取密钥、路由、请求体与 jq 筛选', 'Auto-extract secrets, base URL, body, and jq filter'),
        icon: <IconSparkles size={14} />,
        run: () => openImportModal(),
      },
      {
        id: 'act:new-req',
        label: t('新建 HTTP 请求', 'New HTTP Request'),
        icon: <IconPlus size={14} />,
        run: () => createRequest(null),
      },
      {
        id: 'act:new-folder',
        label: t('新建文件夹', 'New Folder'),
        icon: <IconFolder size={14} />,
        run: () => createFolder(null),
      },
      {
        id: 'act:env',
        label: t('打开环境变量与密钥库', 'Open Environments & Secrets'),
        icon: <IconLayers size={14} />,
        run: () => setEnvModal(true),
      },
      {
        id: 'act:docs',
        label: t('查看 / 导出工作区 Markdown 文档', 'View / Export Workspace Markdown Docs'),
        icon: <IconDoc size={14} />,
        run: () => setDocModal({ scope: 'workspace' }),
      },
      {
        id: 'act:settings',
        label: t('打开设置与数据导入导出', 'Open Settings & Data'),
        icon: <IconSettings size={14} />,
        run: () => setSettingsModal(true),
      },
    ];

    const folderItems: PaletteItem[] = data.folders
      .filter((f) => f.workspaceId === wsId)
      .map((f) => ({
        id: `fld:${f.id}`,
        label: f.name,
        sub: f.host ? t(`目录归档 · ${f.host}`, `Folder · ${f.host}`) : t('文件夹文档与变量', 'Folder docs & variables'),
        icon: <IconFolder size={14} />,
        run: () => selectFolder(f.id),
      }));

    const reqItems: PaletteItem[] = filterWorkspaceRequests(data, wsId, search)
      .map((r) => ({
        id: `req:${r.id}`,
        label: r.name,
        sub: r.url,
        badge: methodShort(r.method),
        badgeColor: methodColor(r.method),
        run: () => selectRequest(r.id),
      }));

    if (search.filtered) return reqItems.slice(0, 24);
    const match = (it: PaletteItem) =>
      it.label.toLowerCase().includes(search.text) || it.sub?.toLowerCase().includes(search.text);
    return [...actions.filter(match), ...reqItems, ...folderItems.filter(match)].slice(0, search.text ? 24 : 20);
  }, [data, wsId, query, lang]);

  if (!commandPalette) return null;

  const exec = (item?: PaletteItem) => {
    if (!item) return;
    setCommandPalette(false);
    item.run();
  };

  return (
    <div
      className="modal-mask cmd-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setCommandPalette(false);
      }}
    >
      <div className="modal cmd-box">
        <div className="cmd-input-row">
          <IconSearch size={15} />
          <input
            ref={inputRef}
            placeholder={t('搜索或执行操作 · method:POST folder:名称', 'Search or run an action · method:POST folder:name')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => (items.length ? (i + 1) % items.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                exec(items[idx]);
              } else if (e.key === 'Escape') {
                setCommandPalette(false);
              }
            }}
          />
          <span className="kbd">ESC</span>
        </div>

        <div className="cmd-list">
          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              {t('未找到匹配项', 'No matching results')}
            </div>
          ) : (
            items.map((it, i) => (
              <div
                key={it.id}
                className={`cmd-item ${i === idx ? 'active' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => exec(it)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, flex: 1 }}>
                  {it.badge ? (
                    <span className="method-tag" style={{ color: it.badgeColor }}>
                      {it.badge}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-dim)', display: 'inline-flex' }}>{it.icon}</span>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.label}
                    </div>
                    {it.sub && (
                      <div
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: 'var(--text-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {it.sub}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
