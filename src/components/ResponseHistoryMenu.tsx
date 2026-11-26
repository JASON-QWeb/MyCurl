import { useI18n } from '../lib/i18n';
import { isComparableResponse } from '../lib/textDiff';
import type { ResponseRecord } from '../lib/types';
import { formatBytes, formatMs, relativeTime } from '../lib/util';
import { useAppStore } from '../store/useAppStore';
import { IconHistory, IconTrash } from './Icons';
import { ResponseDropdown } from './ResponseDropdown';
import { ResponseStatusPill } from './ResponseStatusPill';

interface Props {
  requestId: string;
  history: ResponseRecord[];
  current: ResponseRecord | null;
  onCompare: (id: string) => void;
}

export function ResponseHistoryMenu({ requestId, history, current, onCompare }: Props) {
  const { lang, t } = useI18n();
  const { deleteResponseHistory, selectResponse } = useAppStore();
  const canCompare = current && isComparableResponse(current);
  const trigger = <><IconHistory size={13} /><span>{t('历史', 'History')}{history.length > 0 && ` (${history.length})`}</span></>;
  return (
    <ResponseDropdown label={t('查看历史响应', 'Response history')} trigger={trigger} disabled={!history.length} menuClass="response-history-menu">
      {close => <>
        <div className="response-history-heading">
          <span className="menu-title">{t('最近响应记录', 'Recent Responses')}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => { deleteResponseHistory(requestId); close(); }}>
            {t('清空', 'Clear')}
          </button>
        </div>
        {history.map(h => (
          <div key={h.id} className="response-history-row">
            <button className={`menu-item ${h.id === current?.id ? 'active' : ''}`}
              onClick={() => { selectResponse(requestId, h.id); close(); }}>
              <span className="response-history-metrics">
                <ResponseStatusPill resp={h} compact />
                <span className="mono">{formatMs(h.timeMs)} · {formatBytes(h.size)}</span>
              </span>
              <span className="response-history-time">{relativeTime(h.createdAt, lang)}</span>
            </button>
            {canCompare && h.id !== current.id && isComparableResponse(h) && (
              <button className="btn btn-ghost btn-sm response-history-diff" onClick={e => {
                e.stopPropagation();
                onCompare(h.id);
                close();
              }}>{t('对比', 'Diff')}</button>
            )}
            <button className="btn btn-ghost btn-icon btn-sm" title={t('删除此记录', 'Delete entry')}
              onClick={() => { deleteResponseHistory(requestId, h.id); if (history.length === 1) close(); }}>
              <IconTrash size={11} />
            </button>
          </div>
        ))}
      </>}
    </ResponseDropdown>
  );
}
