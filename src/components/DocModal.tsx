import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { generateFolderDoc, generateWorkspaceDoc } from '../lib/curlExport';
import { copyText } from '../lib/util';
import { MarkdownView } from './MarkdownView';
import { IconCopy, IconDoc, IconDownload, IconX } from './Icons';

export const DocModal: React.FC = () => {
  const { data, docModal, setDocModal, toast } = useAppStore();
  const [view, setView] = useState<'preview' | 'raw'>('preview');

  const wsId = data.settings.activeWorkspaceId || data.workspaces[0].id;
  const folder = docModal?.scope === 'folder' && docModal.folderId ? data.folders.find((f) => f.id === docModal.folderId) : null;

  const md = useMemo(() => {
    if (!docModal) return '';
    if (folder) return generateFolderDoc(data, folder);
    return generateWorkspaceDoc(data, wsId);
  }, [data, docModal, folder, wsId]);

  if (!docModal) return null;

  const title = folder ? `目录归档文档 · ${folder.name}` : '工作区 API 归档文档';

  const download = () => {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const slug = (folder?.name || data.workspaces.find((w) => w.id === wsId)?.name || 'api-docs').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_');
    a.download = `${slug}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已下载 Markdown 文档', 'success');
  };

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setDocModal(null);
      }}
    >
      <div className="modal modal-lg">
        <div className="modal-head">
          <h2>
            <IconDoc size={16} />
            {title}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="segmented">
              <button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>
                渲染预览
              </button>
              <button className={view === 'raw' ? 'active' : ''} onClick={() => setView('raw')}>
                Markdown 源码
              </button>
            </div>
            <button className="btn btn-ghost btn-icon" onClick={() => setDocModal(null)}>
              <IconX size={16} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {view === 'preview' ? (
            <MarkdownView content={md} />
          ) : (
            <pre className="md-pre" style={{ margin: 0 }}>
              <code>{md}</code>
            </pre>
          )}
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>所有密钥字段均已自动脱敏，可安全分享给团队</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn"
              onClick={() => {
                copyText(md);
                toast('已复制 Markdown 文档', 'success');
              }}
            >
              <IconCopy size={13} />
              复制 Markdown
            </button>
            <button className="btn btn-primary" onClick={download}>
              <IconDownload size={13} />
              下载 .md 文件
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
