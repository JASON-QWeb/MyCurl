import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { methodColor, methodShort } from '../lib/util';
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
    const actions: PaletteItem[] = [
      {
        id: 'act:import',
        label: '粘贴 cURL 智能归档',
        sub: '自动提取密钥、路由、请求体与 jq 筛选',
        icon: <IconSparkles size={14} />,
        run: () => openImportModal(),
      },
      {
        id: 'act:new-req',
        label: '新建 HTTP 请求',
        icon: <IconPlus size={14} />,
        run: () => createRequest(null),
      },
      {
        id: 'act:new-folder',
        label: '新建文件夹',
        icon: <IconFolder size={14} />,
        run: () => createFolder(null),
      },
      {
        id: 'act:env',
        label: '打开环境变量与密钥库',
        icon: <IconLayers size={14} />,
        run: () => setEnvModal(true),
      },
      {
        id: 'act:docs',
        label: '查看 / 导出工作区 Markdown 文档',
        icon: <IconDoc size={14} />,
        run: () => setDocModal({ scope: 'workspace' }),
      },
      {
        id: 'act:settings',
        label: '打开设置与数据导入导出',
        icon: <IconSettings size={14} />,
        run: () => setSettingsModal(true),
      },
    ];

    const folderItems: PaletteItem[] = data.folders
      .filter((f) => f.workspaceId === wsId)
      .map((f) => ({
        id: `fld:${f.id}`,
        label: f.name,
        sub: f.host ? `目录归档 · ${f.host}` : '文件夹文档与变量',
        icon: <IconFolder size={14} />,
        run: () => selectFolder(f.id),
      }));

    const reqItems: PaletteItem[] = data.requests
      .filter((r) => r.workspaceId === wsId)
      .map((r) => ({
        id: `req:${r.id}`,
        label: r.name,
        sub: r.url,
        badge: methodShort(r.method),
        badgeColor: methodColor(r.method),
        run: () => selectRequest(r.id),
      }));

    const all = [...actions, ...reqItems, ...folderItems];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 20);
    return all
      .filter((it) => it.label.toLowerCase().includes(q) || (it.sub && it.sub.toLowerCase().includes(q)))
      .slice(0, 24);
  }, [data, wsId, query]);

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
            placeholder="搜索请求、文件夹、或执行操作…"
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
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>未找到匹配项</div>
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
