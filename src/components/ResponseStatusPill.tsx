import { useI18n } from '../lib/i18n';
import type { ResponseRecord } from '../lib/types';

function statusClass(code: number, error?: string) {
  if (error || code === 0) return 'status-err';
  if (code < 300) return 'status-2xx';
  if (code < 400) return 'status-3xx';
  if (code < 500) return 'status-4xx';
  return 'status-5xx';
}

export function ResponseStatusPill({ resp, compact, title }: { resp: ResponseRecord; compact?: boolean; title?: string }) {
  const { t } = useI18n();
  return (
    <span className={`status-pill ${statusClass(resp.status, resp.error)}${compact ? ' response-status-compact' : ''}`} title={title}>
      {resp.error ? t('错误', 'ERR') : compact ? resp.status : `${resp.status} ${resp.statusText}`}
    </span>
  );
}
