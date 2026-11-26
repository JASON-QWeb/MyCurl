import React, { useEffect, useId, useRef, useState } from 'react';
import { exportAsCurl, exportResolvedUrl } from '../lib/curlExport';
import { useI18n } from '../lib/i18n';
import type { CurlCopySecretMode, HttpRequest } from '../lib/types';
import { copyText } from '../lib/util';
import { useAppStore } from '../store/useAppStore';
import { IconCode, IconCopy, IconMore } from './Icons';

function RequestOverflow({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!wrap.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('click', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const label = t('更多请求操作', 'More request actions');
  return (
    <div className="dropdown-wrap" ref={wrap}>
      <button ref={trigger} className="btn btn-ghost btn-icon btn-sm" title={label} aria-label={label}
        aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
        <IconMore size={14} />
      </button>
      {open && <div id={menuId} className="menu-pop right" role="group" aria-label={label} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

export function RequestHeaderActions({ req }: { req: HttpRequest }) {
  const { data, setExportModal, duplicateRequest, deleteRequest, confirm, toast } = useAppStore();
  const { t } = useI18n();
  const mode = data.settings.curlCopySecretMode === 'resolve' ? 'resolve' : 'mask';
  const otherMode = mode === 'mask' ? 'resolve' : 'mask';
  const label = (secretMode: CurlCopySecretMode) => secretMode === 'resolve'
    ? t('复制 cURL（含明文密钥）', 'Copy cURL (raw secrets)')
    : t('复制 cURL（脱敏）', 'Copy cURL (secrets masked)');
  const copy = async (text: string, message: string) => {
    try {
      await copyText(text);
      toast(message, 'success');
    } catch {
      toast(t('无法复制到剪贴板', 'Could not copy to clipboard'), 'error');
    }
  };
  const copyCurl = (secretMode: CurlCopySecretMode) => copy(exportAsCurl(data, req, { secretMode, includeJq: true }),
    secretMode === 'resolve' ? t('已复制 cURL 命令（含明文密钥）', 'Copied cURL (raw secrets included)')
      : t('已复制 cURL 命令（密钥已脱敏）', 'Copied cURL (secrets masked)'));
  const deleteLabel = t('删除请求', 'Delete Request');
  const remove = async () => {
    const confirmed = await confirm({ title: deleteLabel, danger: true, confirmLabel: t('删除', 'Delete'),
      message: t(`确定删除请求「${req.name}」及其响应历史？`, `Delete "${req.name}" and its response history?`) });
    if (confirmed) deleteRequest(req.id);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button className="btn btn-ghost btn-sm" title={label(mode)} onClick={() => copyCurl(mode)}>
        <IconCopy size={13} /> cURL
      </button>
      <button className="btn btn-ghost btn-sm" title={t('生成代码（cURL / fetch / Python / Markdown）', 'Generate code (cURL / fetch / Python / Markdown)')}
        onClick={() => setExportModal(req.id)}>
        <IconCode size={13} /> {t('代码', 'Code')}
      </button>
      <RequestOverflow>
        <button className="menu-item" onClick={() => copyCurl(otherMode)}>{label(otherMode)}</button>
        <button className="menu-item" onClick={() => copy(exportResolvedUrl(data, req, mode), t('已复制解析后的 URL', 'Copied resolved URL'))}>
          {t('复制解析后的 URL', 'Copy Resolved URL')}
        </button>
        <button className="menu-item" onClick={() => duplicateRequest(req.id)}>{t('复制请求副本', 'Duplicate Request')}</button>
        <div className="menu-sep" />
        <button className="menu-item danger" onClick={remove}>{deleteLabel}</button>
      </RequestOverflow>
    </div>
  );
}
