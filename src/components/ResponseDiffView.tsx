import { useMemo } from 'react';
import { useI18n } from '../lib/i18n';
import { diffLines, responseComparableText } from '../lib/textDiff';
import type { ResponseRecord } from '../lib/types';
import { formatMs } from '../lib/util';
import { ResponseStatusPill } from './ResponseStatusPill';

interface Props {
  baseline: ResponseRecord;
  current: ResponseRecord;
  onExit: () => void;
}

function compareBodies(baseline: ResponseRecord, current: ResponseRecord) {
  if (baseline.body === current.body) return null;
  const before = responseComparableText(baseline);
  const after = responseComparableText(current);
  return before === after ? null : diffLines(before, after, 3);
}

export function ResponseDiffView({ baseline, current, onExit }: Props) {
  const { t } = useI18n();
  const diff = useMemo(() => compareBodies(baseline, current), [baseline, current]);
  const delta = current.timeMs - baseline.timeMs;
  const signedDelta = (delta > 0 ? '+' : delta < 0 ? '-' : '') + formatMs(Math.abs(delta));
  const identical = baseline.body === current.body;
  const partial = baseline.bodyTruncated || current.bodyTruncated;
  return (
    <div className="response-diff">
      <div className="response-diff-bar">
        <span className="response-diff-status">
          <ResponseStatusPill resp={baseline} compact title={t('基准响应', 'Baseline response')} /> →
          <ResponseStatusPill resp={current} compact title={t('当前响应', 'Current response')} />
        </span>
        <span className="metric-chip">· {formatMs(baseline.timeMs)} → {formatMs(current.timeMs)} ({signedDelta})</span>
        <span className="response-diff-counts mono">
          <span title={t('新增行数', 'Added lines')}>+{diff?.added ?? 0}</span> / <span title={t('删除行数', 'Removed lines')}>-{diff?.removed ?? 0}</span>
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onExit}>{t('退出对比', 'Exit Diff')}</button>
      </div>
      {partial && <div className="response-diff-note">{t('仅对比已保存的正文片段。', 'Comparing captured body excerpts.')}</div>}
      {!diff || (!diff.added && !diff.removed) ? (
        <div className="empty-state">{identical && !partial ? t('两次响应正文完全一致', 'Response bodies are identical')
          : t('两次响应的对比文本一致', 'Compared response text is identical')}</div>
      ) : <>
        {diff.truncated && <div className="response-diff-note">
          {t('变更区域较大，按整段替换计数，仅显示部分行。', 'Large changed region counted as a replacement. Showing excerpts.')}
        </div>}
        <div className="response-diff-lines mono" role="region" aria-label={t('正文差异', 'Body differences')} tabIndex={0}>
          {diff.lines.map(line => (
            <div key={`${line.kind}-${line.oldLine ?? line.newLine}`} className={`response-diff-line ${line.kind}`}>
              <span className="line-number">{line.oldLine}</span>
              <span className="line-number">{line.newLine}</span>
              <span aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>
              <span className="line-text">{line.text}</span>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}
