import { useI18n } from '../lib/i18n';
import { requestClipboard } from '../lib/requestCopy';
import type { CurlCopySecretMode, HttpRequest } from '../lib/types';
import { useAppStore } from '../store/useAppStore';
import { IconCode, IconCopy } from './Icons';
import { MoreActions } from './MoreActions';

export function RequestHeaderActions({ req }: { req: HttpRequest }) {
  const { data, setExportModal, duplicateRequest, deleteRequest, confirm, toast } = useAppStore();
  const { t } = useI18n();
  const { mode, copyCurl, copyUrl } = requestClipboard(data, toast);
  const otherMode = mode === 'mask' ? 'resolve' : 'mask';
  const label = (secretMode: CurlCopySecretMode) => secretMode === 'resolve'
    ? t('复制 cURL（含明文密钥）', 'Copy cURL (raw secrets)')
    : t('复制 cURL（脱敏）', 'Copy cURL (secrets masked)');
  const deleteLabel = t('删除请求', 'Delete Request');
  const remove = async () => {
    const confirmed = await confirm({ title: deleteLabel, danger: true, confirmLabel: t('删除', 'Delete'),
      message: t(`确定删除请求「${req.name}」及其响应历史？`, `Delete "${req.name}" and its response history?`) });
    if (confirmed) deleteRequest(req.id);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button className="btn btn-ghost btn-sm" title={label(mode)} onClick={() => copyCurl(req)}>
        <IconCopy size={13} /> cURL
      </button>
      <button className="btn btn-ghost btn-sm" title={t('生成代码（cURL / fetch / Python / Markdown）', 'Generate code (cURL / fetch / Python / Markdown)')}
        onClick={() => setExportModal(req.id)}>
        <IconCode size={13} /> {t('代码', 'Code')}
      </button>
      <MoreActions label={t('更多请求操作', 'More request actions')} small>
        <button className="menu-item" onClick={() => copyCurl(req, otherMode)}>{label(otherMode)}</button>
        <button className="menu-item" onClick={() => copyUrl(req)}>
          {t('复制解析后的 URL', 'Copy Resolved URL')}
        </button>
        <button className="menu-item" onClick={() => duplicateRequest(req.id)}>{t('复制请求副本', 'Duplicate Request')}</button>
        <div className="menu-sep" />
        <button className="menu-item danger" onClick={remove}>{deleteLabel}</button>
      </MoreActions>
    </div>
  );
}
