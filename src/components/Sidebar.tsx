import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Folder, HttpRequest } from '../lib/types';
import { copyText, methodColor, methodShort } from '../lib/util';
import { exportAsCurl } from '../lib/curlExport';
import { downloadPostmanCollection } from '../lib/postmanExport';
import { filterSidebarTree, parseRequestSearch } from '../lib/requestSearch';
import { useI18n } from '../lib/i18n';
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDoc,
  IconEdit,
  IconFolder,
  IconFolderOpen,
  IconGlobe,
  IconKey,
  IconPlus,
  IconSearch,
  IconSend,
  IconSparkles,
  IconTrash,
  IconX,
} from './Icons';

interface CtxMenuState {
  x: number;
  y: number;
  kind: 'request' | 'folder';
  id: string;
}

export const Sidebar: React.FC<{ width: number }> = ({ width }) => {
  const {
    data,
    selection,
    expandedFolders,
    sidebarFilter,
    serverInfo,
    setSidebarFilter,
    selectRequest,
    selectFolder,
    toggleFolder,
    setAllFoldersExpanded,
    createFolder,
    updateFolder,
    moveFolder,
    deleteFolder,
    createRequest,
    updateRequest,
    duplicateRequest,
    moveRequest,
    deleteRequest,
    sendRequest,
    openImportModal,
    setExportModal,
    setDocModal,
    confirm,
    toast,
  } = useAppStore();
  const { t } = useI18n();

  const [ctx, setCtx] = useState<CtxMenuState | null>(null);
  const [dragState, setDragState] = useState<{
    kind: 'request' | 'folder';
    id: string;
    label: string;
    x: number;
    y: number;
    target: { kind: 'folder'; id: string } | { kind: 'root' } | null;
  } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'request' | 'folder'; id: string; text: string } | null>(null);
  const suppressClickRef = useRef(false);

  const curlSecretMode = data.settings.curlCopySecretMode === 'resolve' ? 'resolve' : 'mask';
  const copyCurlTitle =
    curlSecretMode === 'resolve'
      ? t('复制为 cURL（含明文密钥）', 'Copy as cURL (raw secrets)')
      : t('复制为 cURL（脱敏）', 'Copy as cURL (masked)');
  const copyRequestAsCurl = (r: HttpRequest) => {
    copyText(exportAsCurl(data, r, { secretMode: curlSecretMode, includeJq: true }));
    toast(
      curlSecretMode === 'resolve'
        ? t('已复制 cURL 命令（含明文密钥）', 'Copied cURL (raw secrets included)')
        : t('已复制 cURL 命令（密钥已脱敏）', 'Copied cURL (secrets masked)'),
      'success',
    );
  };

  useEffect(() => {
    const close = () => setCtx(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const wsId = data.settings.activeWorkspaceId || data.workspaces[0].id;
  const folders = useMemo(
    () => data.folders.filter((f) => f.workspaceId === wsId).sort((a, b) => a.sortOrder - b.sortOrder),
    [data.folders, wsId],
  );
  const requests = useMemo(
    () => data.requests.filter((r) => r.workspaceId === wsId).sort((a, b) => a.sortOrder - b.sortOrder),
    [data.requests, wsId],
  );

  const matches = useMemo(() => sidebarFilter.trim()
    ? filterSidebarTree(data, wsId, parseRequestSearch(sidebarFilter))
    : null, [data, wsId, sidebarFilter]);
  const visibleFolders = matches ? folders.filter(f => matches.folderIds.has(f.id)) : folders;
  const visibleRequests = matches ? requests.filter(r => matches.requestIds.has(r.id)) : requests;
  const anyExpanded = folders.some(folder => expandedFolders[folder.id]);
  const counts = t(`${folders.length} 目录 · ${requests.length} 请求`, `${folders.length} folders · ${requests.length} requests`);

  const handleDeleteFolder = async (f: Folder) => {
    const ok = await confirm({
      title: t('删除文件夹', 'Delete Folder'),
      message: t(
        `确定删除文件夹「${f.name}」及其中的所有子目录和请求吗？此操作无法撤销。`,
        `Delete folder "${f.name}" and all its subfolders and requests? This cannot be undone.`,
      ),
      confirmLabel: t('删除', 'Delete'),
      danger: true,
    });
    if (ok) deleteFolder(f.id);
  };

  const commitRename = () => {
    if (!renaming) return;
    const text = renaming.text.trim();
    if (text) {
      if (renaming.kind === 'folder') updateFolder(renaming.id, { name: text });
      else updateRequest(renaming.id, { name: text });
    }
    setRenaming(null);
  };

  const canDropIntoFolder = (item: { kind: 'request' | 'folder'; id: string }, targetId: string): boolean => {
    if (item.kind === 'request') {
      const req = requests.find((r) => r.id === item.id);
      return !!req && req.folderId !== targetId;
    }
    if (item.id === targetId) return false;
    const dragged = folders.find((f) => f.id === item.id);
    if (!dragged || dragged.parentId === targetId) return false;
    // 防止拖入自己的子孙目录
    let cur: string | null = targetId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === item.id) return false;
      seen.add(cur);
      cur = folders.find((f) => f.id === cur)?.parentId ?? null;
    }
    return true;
  };

  const canDropToRoot = (item: { kind: 'request' | 'folder'; id: string }): boolean => {
    if (item.kind === 'request') {
      return !!requests.find((r) => r.id === item.id)?.folderId;
    }
    return !!folders.find((f) => f.id === item.id)?.parentId;
  };

  const startPointerDrag = (
    e: React.PointerEvent,
    item: { kind: 'request' | 'folder'; id: string; label: string },
  ) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let currentTarget: { kind: 'folder'; id: string } | { kind: 'root' } | null = null;

    const resolveTarget = (clientX: number, clientY: number) => {
      const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const folderEl = el?.closest('[data-drop-folder-id]') as HTMLElement | null;
      if (folderEl) {
        const targetId = folderEl.getAttribute('data-drop-folder-id')!;
        if (canDropIntoFolder(item, targetId)) {
          return { kind: 'folder' as const, id: targetId };
        }
        return null;
      }
      if (el?.closest('[data-drop-root="true"]') && canDropToRoot(item)) {
        return { kind: 'root' as const };
      }
      return null;
    };

    const onMove = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        active = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }
      currentTarget = resolveTarget(ev.clientX, ev.clientY);
      setDragState({
        kind: item.kind,
        id: item.id,
        label: item.label,
        x: ev.clientX,
        y: ev.clientY,
        target: currentTarget,
      });
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setDragState(null);
    };

    const onUp = () => {
      if (active) {
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        if (currentTarget?.kind === 'folder') {
          if (item.kind === 'request') moveRequest(item.id, currentTarget.id);
          else moveFolder(item.id, currentTarget.id);
        } else if (currentTarget?.kind === 'root') {
          if (item.kind === 'request') moveRequest(item.id, null);
          else moveFolder(item.id, null);
        }
      }
      cleanup();
    };

    const onCancel = () => {
      cleanup();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const renderRequestRow = (r: HttpRequest, depth: number) => {
    const active = selection?.kind === 'request' && selection.id === r.id;
    const isRenaming = renaming?.kind === 'request' && renaming.id === r.id;
    const isDragging = dragState?.kind === 'request' && dragState.id === r.id;
    return (
      <div
        key={r.id}
        className={`tree-row ${active ? 'active' : ''}`}
        style={{ paddingLeft: 10 + depth * 15, opacity: isDragging ? 0.45 : 1 }}
        onPointerDown={(e) => {
          if (!isRenaming) startPointerDrag(e, { kind: 'request', id: r.id, label: r.name || t('未命名请求', 'Untitled Request') });
        }}
        onClick={() => {
          if (suppressClickRef.current) return;
          selectRequest(r.id);
        }}
        onDoubleClick={() => setRenaming({ kind: 'request', id: r.id, text: r.name })}
        onContextMenu={(e) => {
          e.preventDefault();
          setCtx({ x: e.clientX, y: e.clientY, kind: 'request', id: r.id });
        }}
      >
        <span className="method-tag" style={{ color: methodColor(r.method) }}>
          {methodShort(r.method)}
        </span>
        {isRenaming ? (
          <input
            autoFocus
            className="input input-sm"
            style={{ flex: 1, height: 22 }}
            value={renaming.text}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenaming({ ...renaming, text: e.target.value })}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(null);
            }}
          />
        ) : (
          <span className="tree-label" title={`${r.method} ${r.url}`}>
            {r.name || t('未命名请求', 'Untitled Request')}
          </span>
        )}
        <div className="tree-hover-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            title={copyCurlTitle}
            onClick={() => copyRequestAsCurl(r)}
          >
            <IconCopy size={12} />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            title={t('删除请求', 'Delete request')}
            onClick={() => deleteRequest(r.id)}
          >
            <IconTrash size={12} />
          </button>
        </div>
      </div>
    );
  };

  const renderFolder = (f: Folder, depth: number) => {
    const expanded = !!matches || !!expandedFolders[f.id];
    const active = selection?.kind === 'folder' && selection.id === f.id;
    const childFolders = visibleFolders.filter((c) => c.parentId === f.id);
    const childReqs = visibleRequests.filter((r) => r.folderId === f.id);
    const secretCount = f.variables.filter((v) => v.secret && v.enabled).length;
    const isRenaming = renaming?.kind === 'folder' && renaming.id === f.id;
    const isDragging = dragState?.kind === 'folder' && dragState.id === f.id;
    const isDropTarget = dragState?.target?.kind === 'folder' && dragState.target.id === f.id;

    return (
      <div key={f.id}>
        <div
          data-drop-folder-id={f.id}
          className={`tree-row folder-row ${active ? 'active' : ''} ${isDropTarget ? 'drag-over' : ''}`}
          style={{ paddingLeft: 6 + depth * 15, opacity: isDragging ? 0.45 : 1 }}
          onPointerDown={(e) => {
            if (!isRenaming) startPointerDrag(e, { kind: 'folder', id: f.id, label: f.name });
          }}
          onClick={() => {
            if (suppressClickRef.current || matches) return;
            toggleFolder(f.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtx({ x: e.clientX, y: e.clientY, kind: 'folder', id: f.id });
          }}
        >
          <span style={{ display: 'inline-flex', color: 'var(--text-muted)' }}>
            {expanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
          </span>
          <span style={{ display: 'inline-flex', color: f.host ? 'var(--accent)' : 'var(--text-dim)' }}>
            {f.host ? <IconGlobe size={13} /> : expanded ? <IconFolderOpen size={14} /> : <IconFolder size={14} />}
          </span>
          {isRenaming ? (
            <input
              autoFocus
              className="input input-sm"
              style={{ flex: 1, height: 22 }}
              value={renaming.text}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenaming({ ...renaming, text: e.target.value })}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <span className="tree-label" title={f.host ? t(`站点归档：${f.host}`, `Host: ${f.host}`) : f.name}>
              {f.name}
            </span>
          )}
          <div className="tree-meta">
            {secretCount > 0 && (
              <span className="key-badge tree-badge-hide" title={t(`已收纳 ${secretCount} 个密钥变量`, `${secretCount} secret variable(s)`)}>
                <IconKey size={10} />
                {secretCount}
              </span>
            )}
            <div className="tree-hover-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title={t('查看文件夹归档文档与密钥变量', 'Open folder docs & secrets')}
                onClick={() => selectFolder(f.id)}
              >
                <IconDoc size={12} />
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title={t('在此文件夹中新建请求', 'New request in folder')}
                onClick={() => createRequest(f.id)}
              >
                <IconPlus size={12} />
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title={t('删除文件夹', 'Delete folder')}
                onClick={() => handleDeleteFolder(f)}
              >
                <IconTrash size={12} />
              </button>
            </div>
          </div>
        </div>
        {expanded && (
          <div>
            {childFolders.map((cf) => renderFolder(cf, depth + 1))}
            {childReqs.map((r) => renderRequestRow(r, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const topFolders = visibleFolders.filter((f) => !f.parentId);
  const rootReqs = visibleRequests.filter((r) => !r.folderId);

  const ctxReq = ctx?.kind === 'request' ? requests.find((r) => r.id === ctx.id) : null;
  const ctxFolder = ctx?.kind === 'folder' ? folders.find((f) => f.id === ctx.id) : null;

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-top">
        <div className="sidebar-search">
          <IconSearch size={13} />
          <input
            placeholder={t('筛选接口、域名、路径…', 'Filter requests, hosts, paths…')}
            title={t('可组合筛选，例如 method:POST folder:name', 'Combine filters, e.g. method:POST folder:name')}
            value={sidebarFilter}
            onChange={(e) => setSidebarFilter(e.target.value)}
          />
          {sidebarFilter && (
            <button className="clear-btn" onClick={() => setSidebarFilter('')}>
              <IconX size={12} />
            </button>
          )}
        </div>
        <div className="sidebar-actions">
          <button
            className="btn"
            onClick={() => createRequest(selection?.kind === 'folder' ? selection.id : null)}
            title={t('新建 HTTP 请求 (⌘N)', 'New HTTP Request (⌘N)')}
          >
            <IconPlus size={12} />
            {t('请求', 'Request')}
          </button>
          <button className="btn" onClick={() => createFolder(null)} title={t('新建文件夹', 'New Folder')}>
            <IconFolder size={12} />
            {t('文件夹', 'Folder')}
          </button>
          <button className="btn btn-soft" onClick={() => openImportModal()} title={t('粘贴 cURL 智能归档', 'Paste cURL to Import')}>
            <IconSparkles size={12} />
            cURL
          </button>
        </div>
      </div>

      <div
        data-drop-root="true"
        className={`tree-scroll ${dragState?.target?.kind === 'root' ? 'drag-over-root' : ''}`}
      >
        {topFolders.map((f) => renderFolder(f, 0))}
        {rootReqs.map((r) => renderRequestRow(r, 0))}
        {topFolders.length === 0 && rootReqs.length === 0 && (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            {matches ? t('未找到匹配项', 'No matching results') : t(
              '还没有接口，点击上方「cURL」直接粘贴 AI 给的指令即可自动归档。',
              'No requests yet. Click "cURL" above to paste and auto-organize a cURL command.',
            )}
          </div>
        )}
      </div>

      <div className="sidebar-footer" style={{ gap: 4, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <span title={counts} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{counts}</span>
          {folders.length > 0 && !matches && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ height: 'auto', padding: '0 2px', fontSize: 'inherit' }}
              title={anyExpanded ? t('折叠所有文件夹', 'Collapse all folders') : t('展开所有文件夹', 'Expand all folders')}
              onClick={() => setAllFoldersExpanded(wsId, !anyExpanded)}
            >
              {anyExpanded ? t('折叠', 'Collapse') : t('展开', 'Expand')}
            </button>
          )}
        </div>
        <span title={serverInfo?.dataDir || t('本地存储', 'Local Storage')}>
          {serverInfo?.runtime === 'rust-tauri'
            ? t('Rust 内核 ✓', 'Rust Core ✓')
            : serverInfo
              ? t('本地存储 ✓', 'Local ✓')
              : t('浏览器模式', 'Browser')}
        </span>
      </div>

      {/* 拖拽悬浮提示 */}
      {dragState && (
        <div
          className="drag-ghost"
          style={{ left: dragState.x + 12, top: dragState.y + 12 }}
        >
          {dragState.kind === 'folder' && <IconFolder size={13} />}
          <span>{dragState.label}</span>
          {dragState.target?.kind === 'folder' && (() => {
            const tid = dragState.target.id;
            return (
              <span style={{ color: 'var(--accent)', fontSize: 11 }}>
                → {folders.find((f) => f.id === tid)?.name}
              </span>
            );
          })()}
          {dragState.target?.kind === 'root' && (
            <span style={{ color: 'var(--accent)', fontSize: 11 }}>
              → {t('根目录', 'Root')}
            </span>
          )}
        </div>
      )}

      {/* 右键菜单 */}
      {ctx && (ctxReq || ctxFolder) && (
        <div
          className="ctx-menu"
          style={{
            left: Math.min(ctx.x, window.innerWidth - 190),
            top: Math.max(0, Math.min(ctx.y, window.innerHeight - (ctxFolder ? 270 : 240))),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxReq && (
            <>
              <button
                className="menu-item"
                onClick={() => {
                  selectRequest(ctxReq.id);
                  sendRequest(ctxReq.id);
                  setCtx(null);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconSend size={13} />
                  {t('立即发送', 'Send Now')}
                </span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  copyRequestAsCurl(ctxReq);
                  setCtx(null);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconCopy size={13} />
                  {t('复制为 cURL', 'Copy as cURL')}
                </span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setExportModal(ctxReq.id);
                  setCtx(null);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconDoc size={13} />
                  {t('导出代码 / 文档…', 'Export Code / Docs…')}
                </span>
              </button>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  duplicateRequest(ctxReq.id);
                  setCtx(null);
                }}
              >
                <span>{t('复制请求', 'Duplicate')}</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setRenaming({ kind: 'request', id: ctxReq.id, text: ctxReq.name });
                  setCtx(null);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconEdit size={13} />
                  {t('重命名', 'Rename')}
                </span>
              </button>
              {ctxReq.folderId && (
                <button
                  className="menu-item"
                  onClick={() => {
                    moveRequest(ctxReq.id, null);
                    setCtx(null);
                  }}
                >
                  <span>{t('移至根目录', 'Move to Root')}</span>
                </button>
              )}
              <div className="menu-sep" />
              <button
                className="menu-item danger"
                onClick={() => {
                  deleteRequest(ctxReq.id);
                  setCtx(null);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconTrash size={13} />
                  {t('删除请求', 'Delete Request')}
                </span>
              </button>
            </>
          )}
          {ctxFolder && (
            <>
              <button
                className="menu-item"
                onClick={() => {
                  selectFolder(ctxFolder.id);
                  setCtx(null);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconDoc size={13} />
                  {t('打开归档文档与密钥', 'Open Docs & Secrets')}
                </span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setDocModal({ scope: 'folder', folderId: ctxFolder.id });
                  setCtx(null);
                }}
              >
                <span>{t('导出 Markdown 文档…', 'Export Markdown Docs…')}</span>
              </button>
              <button className="menu-item" onClick={() => {
                downloadPostmanCollection(data, wsId, ctxFolder.id);
                setCtx(null);
              }}>
                <span>{t('导出 Postman 集合…', 'Export Postman Collection…')}</span>
              </button>
              <div className="menu-sep" />
              <button
                className="menu-item"
                onClick={() => {
                  createRequest(ctxFolder.id);
                  setCtx(null);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconPlus size={13} />
                  {t('新建请求', 'New Request')}
                </span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  createFolder(ctxFolder.id, t('子文件夹', 'Subfolder'));
                  setCtx(null);
                }}
              >
                <span>{t('新建子文件夹', 'New Subfolder')}</span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setRenaming({ kind: 'folder', id: ctxFolder.id, text: ctxFolder.name });
                  setCtx(null);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconEdit size={13} />
                  {t('重命名', 'Rename')}
                </span>
              </button>
              {ctxFolder.parentId && (
                <button
                  className="menu-item"
                  onClick={() => {
                    moveFolder(ctxFolder.id, null);
                    setCtx(null);
                  }}
                >
                  <span>{t('移至根目录', 'Move to Root')}</span>
                </button>
              )}
              <div className="menu-sep" />
              <button
                className="menu-item danger"
                onClick={() => {
                  const target = ctxFolder;
                  setCtx(null);
                  void handleDeleteFolder(target);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconTrash size={13} />
                  {t('删除文件夹', 'Delete Folder')}
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};
