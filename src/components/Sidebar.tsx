import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Folder, HttpRequest } from '../lib/types';
import { copyText, methodColor, methodShort } from '../lib/util';
import { exportAsCurl } from '../lib/curlExport';
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
    createFolder,
    updateFolder,
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

  const [ctx, setCtx] = useState<CtxMenuState | null>(null);
  const [dragReqId, setDragReqId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ kind: 'request' | 'folder'; id: string; text: string } | null>(null);

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

  const q = sidebarFilter.trim().toLowerCase();

  const matchesReq = (r: HttpRequest) =>
    !q ||
    r.name.toLowerCase().includes(q) ||
    r.url.toLowerCase().includes(q) ||
    r.method.toLowerCase().includes(q);

  const folderHasMatch = (fid: string): boolean => {
    const f = folders.find((x) => x.id === fid);
    if (!f) return false;
    if (!q) return true;
    if (f.name.toLowerCase().includes(q) || (f.host && f.host.toLowerCase().includes(q))) return true;
    if (requests.some((r) => r.folderId === fid && matchesReq(r))) return true;
    return folders.some((c) => c.parentId === fid && folderHasMatch(c.id));
  };

  const handleDeleteFolder = async (f: Folder) => {
    const ok = await confirm({
      title: '删除文件夹',
      message: `确定删除文件夹「${f.name}」及其中的所有子目录和请求吗？此操作无法撤销。`,
      confirmLabel: '删除',
      danger: true,
    });
    if (ok) deleteFolder(f.id);
  };

  const commitRename = () => {
    if (!renaming) return;
    const t = renaming.text.trim();
    if (t) {
      if (renaming.kind === 'folder') updateFolder(renaming.id, { name: t });
      else updateRequest(renaming.id, { name: t });
    }
    setRenaming(null);
  };

  const renderRequestRow = (r: HttpRequest, depth: number) => {
    const active = selection?.kind === 'request' && selection.id === r.id;
    const isRenaming = renaming?.kind === 'request' && renaming.id === r.id;
    return (
      <div
        key={r.id}
        className={`tree-row ${active ? 'active' : ''}`}
        style={{ paddingLeft: 10 + depth * 15 }}
        draggable
        onDragStart={(e) => {
          setDragReqId(r.id);
          e.dataTransfer.setData('text/plain', r.id);
        }}
        onDragEnd={() => {
          setDragReqId(null);
          setDragOverId(null);
        }}
        onClick={() => selectRequest(r.id)}
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
            {r.name || '未命名请求'}
          </span>
        )}
        <div className="tree-hover-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            title="复制为 cURL（脱敏）"
            onClick={() => {
              copyText(exportAsCurl(data, r, { secretMode: 'mask', includeJq: true }));
              toast('已复制 cURL 命令（密钥已脱敏）', 'success');
            }}
          >
            <IconCopy size={12} />
          </button>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            title="删除请求"
            onClick={() => deleteRequest(r.id)}
          >
            <IconTrash size={12} />
          </button>
        </div>
      </div>
    );
  };

  const renderFolder = (f: Folder, depth: number) => {
    if (!folderHasMatch(f.id)) return null;
    const expanded = q ? true : !!expandedFolders[f.id];
    const active = selection?.kind === 'folder' && selection.id === f.id;
    const childFolders = folders.filter((c) => c.parentId === f.id);
    const childReqs = requests.filter((r) => r.folderId === f.id && (q ? matchesReq(r) || f.name.toLowerCase().includes(q) : true));
    const secretCount = f.variables.filter((v) => v.secret && v.enabled).length;
    const isRenaming = renaming?.kind === 'folder' && renaming.id === f.id;

    return (
      <div key={f.id}>
        <div
          className={`tree-row folder-row ${active ? 'active' : ''} ${dragOverId === f.id ? 'drag-over' : ''}`}
          style={{ paddingLeft: 6 + depth * 15 }}
          onClick={() => toggleFolder(f.id)}
          onDragOver={(e) => {
            if (!dragReqId) return;
            e.preventDefault();
            setDragOverId(f.id);
          }}
          onDragLeave={() => setDragOverId(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (dragReqId) moveRequest(dragReqId, f.id);
            setDragReqId(null);
            setDragOverId(null);
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
            <span className="tree-label" title={f.host ? `站点归档：${f.host}` : f.name}>
              {f.name}
            </span>
          )}
          <div className="tree-meta">
            {secretCount > 0 && (
              <span className="key-badge tree-badge-hide" title={`已收纳 ${secretCount} 个密钥变量`}>
                <IconKey size={10} />
                {secretCount}
              </span>
            )}
            <div className="tree-hover-actions" onClick={(e) => e.stopPropagation()}>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="查看文件夹归档文档与密钥变量"
                onClick={() => selectFolder(f.id)}
              >
                <IconDoc size={12} />
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="在此文件夹中新建请求"
                onClick={() => createRequest(f.id)}
              >
                <IconPlus size={12} />
              </button>
              <button
                className="btn btn-ghost btn-icon btn-sm"
                title="删除文件夹"
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

  const topFolders = folders.filter((f) => !f.parentId);
  const rootReqs = requests.filter((r) => !r.folderId && matchesReq(r));

  const ctxReq = ctx?.kind === 'request' ? requests.find((r) => r.id === ctx.id) : null;
  const ctxFolder = ctx?.kind === 'folder' ? folders.find((f) => f.id === ctx.id) : null;

  return (
    <aside className="sidebar" style={{ width }}>
      <div className="sidebar-top">
        <div className="sidebar-search">
          <IconSearch size={13} />
          <input
            placeholder="筛选接口、域名、路径…"
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
          <button className="btn" onClick={() => createRequest(selection?.kind === 'folder' ? selection.id : null)} title="新建 HTTP 请求 (⌘N)">
            <IconPlus size={12} />
            请求
          </button>
          <button className="btn" onClick={() => createFolder(null)} title="新建文件夹">
            <IconFolder size={12} />
            文件夹
          </button>
          <button className="btn btn-soft" onClick={() => openImportModal()} title="粘贴 cURL 智能归档">
            <IconSparkles size={12} />
            cURL
          </button>
        </div>
      </div>

      <div
        className="tree-scroll"
        onDragOver={(e) => {
          if (dragReqId) e.preventDefault();
        }}
        onDrop={(e) => {
          if (dragReqId && !dragOverId) {
            e.preventDefault();
            moveRequest(dragReqId, null);
            setDragReqId(null);
          }
        }}
      >
        {topFolders.map((f) => renderFolder(f, 0))}
        {rootReqs.map((r) => renderRequestRow(r, 0))}
        {topFolders.length === 0 && rootReqs.length === 0 && (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            还没有接口，点击上方「cURL」直接粘贴 AI 给的指令即可自动归档。
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <span>
          {folders.length} 目录 · {requests.length} 请求
        </span>
        <span title={serverInfo?.dataDir || '本地存储'}>
          {serverInfo?.runtime === 'rust-tauri' ? 'Rust 内核 ✓' : serverInfo ? '本地存储 ✓' : '浏览器模式'}
        </span>
      </div>

      {/* 右键菜单 */}
      {ctx && (ctxReq || ctxFolder) && (
        <div
          className="ctx-menu"
          style={{
            left: Math.min(ctx.x, window.innerWidth - 190),
            top: Math.min(ctx.y, window.innerHeight - 240),
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
                  立即发送
                </span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  copyText(exportAsCurl(data, ctxReq, { secretMode: 'mask', includeJq: true }));
                  toast('已复制为 cURL（密钥已脱敏）', 'success');
                  setCtx(null);
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <IconCopy size={13} />
                  复制为 cURL
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
                  导出代码 / 文档…
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
                <span>复制请求</span>
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
                  重命名
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
                  <span>移至根目录</span>
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
                  删除请求
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
                  打开归档文档与密钥
                </span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  setDocModal({ scope: 'folder', folderId: ctxFolder.id });
                  setCtx(null);
                }}
              >
                <span>导出 Markdown 文档…</span>
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
                  新建请求
                </span>
              </button>
              <button
                className="menu-item"
                onClick={() => {
                  createFolder(ctxFolder.id, '子文件夹');
                  setCtx(null);
                }}
              >
                <span>新建子文件夹</span>
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
                  重命名
                </span>
              </button>
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
                  删除文件夹
                </span>
              </button>
            </>
          )}
        </div>
      )}
    </aside>
  );
};
