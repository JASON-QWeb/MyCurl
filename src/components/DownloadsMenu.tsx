import { useI18n } from '../lib/i18n';
import { copyText, formatBytes, relativeTime } from '../lib/util';
import { useAppStore } from '../store/useAppStore';
import { ResponseDropdown } from './ResponseDropdown';
import { IconCopy, IconDownload, IconFolderOpen, IconTrash } from './Icons';

export function DownloadsMenu() {
  const { t, lang } = useI18n();
  const { downloads, serverInfo, loadDownloads, revealInFolder, deleteDownloadRecord, toast } = useAppStore();
  const dir = serverInfo?.downloadDir;
  const source = { response: t('响应体', 'Response'), backup: t('备份', 'Backup'), postman: 'Postman', doc: t('文档', 'Docs') };
  async function copyPath(path: string) {
    try {
      await copyText(path);
      toast(t('已复制路径', 'Copied path'), 'success');
    } catch (err) { toast(String(err), 'error'); }
  }
  return <ResponseDropdown label={t('下载记录', 'Downloads')} onOpen={loadDownloads} menuClass="downloads-menu" iconOnly
    trigger={<><IconDownload size={15} />{!!downloads.length && <span className="download-count">{downloads.length}</span>}</>}>
    {() => <>
      <div className="response-history-heading"><strong>{t('下载记录', 'Downloads')}</strong>
        {dir && <button className="btn btn-sm" onClick={() => revealInFolder(dir)}>{t('打开目录', 'Open Folder')}</button>}
        {!!downloads.length && <button className="btn btn-ghost btn-sm" onClick={() => deleteDownloadRecord()}>{t('清空', 'Clear')}</button>}
      </div>
      {!downloads.length && <p>{t('暂无下载记录', 'No downloads yet')}</p>}
      {downloads.map(r => <div key={r.id} className="download-row">
        <div className="download-details" title={r.path || r.filename}>
          <strong>{r.filename}</strong>
          <span>{source[r.source]} · {formatBytes(r.size)} · {relativeTime(r.createdAt, lang)}</span>
          {r.exists === false && <span>{t('文件已移动或删除', 'File missing')}</span>}
        </div>
        {(r.path || r.dir) && <button className="btn btn-icon btn-ghost" title={t('打开文件夹', 'Show in Folder')}
          onClick={() => revealInFolder((r.path || r.dir)!)}><IconFolderOpen size={14}/></button>}
        {r.path && <button className="btn btn-icon btn-ghost" title={t('复制路径', 'Copy path')}
          onClick={() => copyPath(r.path!)}><IconCopy size={14}/></button>}
        <button className="btn btn-icon btn-ghost" title={t('删除记录', 'Remove')} onClick={() => deleteDownloadRecord(r.id)}><IconTrash size={14}/></button>
      </div>)}
    </>}
  </ResponseDropdown>;
}
