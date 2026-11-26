import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { methodColor, methodShort } from '../lib/util';
import { filterWorkspaceRequests, parseRequestSearch } from '../lib/requestSearch';
import { requestClipboard } from '../lib/requestCopy';
import { tr, useI18n } from '../lib/i18n';
import { IconCode, IconCopy, IconDoc, IconFolder, IconLayers, IconPlus, IconSearch,
  IconSend, IconSettings, IconSparkles, IconSplit, IconSun } from './Icons';

interface PaletteItem {
  id: string;
  label: string;
  alternateLabel?: string;
  sub?: string;
  badge?: string;
  badgeColor?: string;
  icon?: React.ReactNode;
  run: () => void;
}

type PaletteState = ReturnType<typeof useAppStore.getState>;

function paletteActions(state: PaletteState, wsId: string) {
  const { data, selection } = state;
  const lang = data.settings.language;
  const action = (id: string, zh: string, en: string, Icon: typeof IconPlus, run: () => void, sub?: string): PaletteItem => ({
    id: `act:${id}`, label: tr(lang, zh, en), alternateLabel: lang === 'en' ? zh : en, icon: <Icon size={14} />, run, sub,
  });
  const actions = [
    action('import', '粘贴 cURL 智能归档', 'Paste cURL to Import', IconSparkles, () => state.openImportModal(),
      tr(lang, '自动提取密钥、路由、请求体与 jq 筛选', 'Auto-extract secrets, base URL, body, and jq filter')),
  ];
  const req = selection?.kind === 'request' ? data.requests.find(r => r.id === selection.id) : undefined;
  if (req) {
    actions.push(
      action('send', '发送当前请求', 'Send Active Request', IconSend, () => state.sendRequest(req.id), req.name),
      action('copy', '复制当前请求为 cURL', 'Copy Active Request as cURL', IconCopy, () => requestClipboard(data, state.toast).copyCurl(req)),
      action('export', '导出当前请求代码 / 文档', 'Export Active Request Code / Docs', IconCode, () => state.setExportModal(req.id)),
      action('duplicate', '复制当前请求副本', 'Duplicate Active Request', IconCopy, () => state.duplicateRequest(req.id)),
    );
  }
  actions.push(
    action('new-req', '新建 HTTP 请求', 'New HTTP Request', IconPlus, () => state.createRequest(null)),
    action('new-folder', '新建文件夹', 'New Folder', IconFolder, () => state.createFolder(null)),
  );
  const moreActions = [
    action('env', '打开环境变量与密钥库', 'Open Environments & Secrets', IconLayers, () => state.setEnvModal(true)),
    action('docs', '查看 / 导出工作区 Markdown 文档', 'View / Export Workspace Markdown Docs', IconDoc, () => state.setDocModal({ scope: 'workspace' })),
    action('settings', '打开设置与数据导入导出', 'Open Settings & Data', IconSettings, () => state.setSettingsModal(true)),
    action('theme', '切换深色 / 浅色主题', 'Toggle Dark / Light Theme', IconSun, state.toggleTheme),
    action('layout', '切换左右 / 上下布局', 'Toggle Horizontal / Vertical Layout', IconSplit, state.toggleLayout),
  ];
  const active = tr(lang, '(当前)', '(Active)');
  const envs = data.environments.filter(e => e.workspaceId === wsId && !e.isBase);
  if (envs.length) {
    const envId = data.settings.activeEnvironment[wsId] ?? null;
    moreActions.push(action('global', '切换环境：仅全局变量', 'Switch Environment: Global Only', IconLayers,
      () => state.setActiveEnvironment(null), envId === null ? active : undefined));
    for (const env of envs) {
      moreActions.push(action(`env:${env.id}`, `切换环境：${env.name}`, `Switch Environment: ${env.name}`, IconLayers,
        () => state.setActiveEnvironment(env.id), envId === env.id ? active : undefined));
    }
  }
  if (data.workspaces.length > 1) {
    for (const ws of data.workspaces) {
      moreActions.push(action(`ws:${ws.id}`, `切换工作区：${ws.name}`, `Switch Workspace: ${ws.name}`, IconFolder,
        () => state.setActiveWorkspace(ws.id), ws.id === wsId ? active : undefined));
    }
  }
  return { actions, moreActions };
}

function paletteItems(state: PaletteState, query: string) {
  const { data, selectRequest, selectFolder } = state;
  const { language, activeWorkspaceId } = data.settings;
  const wsId = activeWorkspaceId || data.workspaces[0].id;
  const search = parseRequestSearch(query);
  const reqItems: PaletteItem[] = filterWorkspaceRequests(data, wsId, search).map(r => ({
    id: `req:${r.id}`, label: r.name, sub: r.url, badge: methodShort(r.method), badgeColor: methodColor(r.method),
    run: () => selectRequest(r.id),
  }));
  if (search.filtered) return reqItems.slice(0, 24);
  const { actions, moreActions } = paletteActions(state, wsId);
  const folderItems: PaletteItem[] = data.folders.filter(f => f.workspaceId === wsId).map(f => ({
    id: `fld:${f.id}`, label: f.name, icon: <IconFolder size={14} />, run: () => selectFolder(f.id),
    sub: f.host ? tr(language, `目录归档 · ${f.host}`, `Folder · ${f.host}`) : tr(language, '文件夹文档与变量', 'Folder docs & variables'),
  }));
  if (!search.text) {
    const requestSlots = 20 - actions.length - Math.min(folderItems.length, 3);
    return [...actions, ...reqItems.slice(0, requestSlots), ...folderItems].slice(0, 20).concat(moreActions);
  }
  const terms = search.text.split(/\s+/);
  const matchesCommand = (item: PaletteItem) => {
    const text = [item.label, item.alternateLabel, item.sub].join(' ').toLowerCase();
    return terms.every(term => text.includes(term));
  };
  const folders = folderItems.filter(item => [item.label, item.sub].some(s => s?.toLowerCase().includes(search.text)));
  return [...actions.filter(matchesCommand), ...moreActions.filter(matchesCommand), ...reqItems, ...folders].slice(0, 24);
}

export function CommandPalette() {
  const open = useAppStore(s => s.commandPalette);
  return open ? <PaletteDialog /> : null;
}

function ItemContent({ item }: { item: PaletteItem }) {
  const truncate: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, flex: 1 }}>
      {item.badge ? <span className="method-tag" style={{ color: item.badgeColor }}>{item.badge}</span>
        : <span style={{ color: 'var(--text-dim)', display: 'inline-flex' }}>{item.icon}</span>}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ ...truncate, fontWeight: 500 }}>{item.label}</div>
        {item.sub && <div className="mono" style={{ ...truncate, fontSize: 11, color: 'var(--text-muted)' }}>{item.sub}</div>}
      </div>
    </div>
  );
}

function PaletteDialog() {
  const state = useAppStore();
  const { setCommandPalette } = state;
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const label = t('命令面板', 'Command Palette');
  const items = useMemo(() => paletteItems(state, query), [state, query]);
  useEffect(() => {
    listRef.current?.querySelector('.cmd-item.active')?.scrollIntoView?.({ block: 'nearest' });
  }, [idx]);

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
      <div className="modal cmd-box" role="dialog" aria-modal="true" aria-label={label}>
        <div className="cmd-input-row">
          <IconSearch size={15} />
          <input
            autoFocus
            role="combobox" aria-label={label} aria-expanded aria-controls={listId} aria-autocomplete="list"
            aria-activedescendant={items[idx] ? `${listId}-${idx}` : undefined}
            placeholder={t('搜索或执行操作 · method:POST folder:名称', 'Search or run an action · method:POST folder:name')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => (items.length ? (i + 1) % items.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                exec(items[idx]);
              } else if (e.key === 'Escape') {
                setCommandPalette(false);
              }
            }}
          />
          <span className="kbd">ESC</span>
        </div>

        <div className="cmd-list" ref={listRef} id={listId} role="listbox" aria-label={label}>
          {items.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              {t('未找到匹配项', 'No matching results')}
            </div>
          ) : (
            items.map((it, i) => (
              <div
                key={it.id}
                id={`${listId}-${i}`} role="option" aria-selected={i === idx}
                className={`cmd-item ${i === idx ? 'active' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => exec(it)}
              >
                <ItemContent item={it} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
