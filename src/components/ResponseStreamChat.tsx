import React, { useId, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n';
import type { ResponseStream } from '../lib/responseStream';
import { copyText } from '../lib/util';
import { useAppStore } from '../store/useAppStore';
import { IconChevronDown, IconChevronRight, IconCopy } from './Icons';
import { MarkdownView } from './MarkdownView';

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const toast = useAppStore(s => s.toast);
  return (
    <button className="btn btn-ghost btn-icon btn-sm" title={label} aria-label={label} disabled={!text}
      onClick={async e => {
        e.stopPropagation();
        try {
          await copyText(text);
          toast(t('已复制到剪贴板', 'Copied to clipboard'), 'success');
        } catch {
          toast(t('无法复制到剪贴板', 'Could not copy to clipboard'), 'error');
        }
      }}
    >
      <IconCopy size={12} />
    </button>
  );
}

export function ResponseStreamChat({ stream }: { stream: ResponseStream }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  const [markdown, setMarkdown] = useState(false);
  const reasoningId = useId();
  const { assembledReasoning, assembledText, events, done, error } = stream;
  const length = useMemo(() => Array.from(assembledReasoning).length, [assembledReasoning]);

  return (
    <div className="sse-view">
      {error !== undefined && (
        <div className="jq-error" role="alert">
          {error ? t(`流式响应错误：${error}`, `Stream error: ${error}`) : t('流式响应错误', 'Stream error')}
        </div>
      )}
      {assembledReasoning && (
        <div>
          <div className="sse-section-head">
            <button className="sse-reason-toggle" aria-expanded={expanded} aria-controls={reasoningId}
              onClick={() => setExpanded(!expanded)}>
              {expanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              {t(`思考过程（${length} 字）`, `Reasoning (${length} chars)`)}
            </button>
            <CopyButton text={assembledReasoning} label={t('复制思考过程', 'Copy reasoning')} />
          </div>
          <div id={reasoningId} className="sse-reasoning" hidden={!expanded}>{assembledReasoning}</div>
        </div>
      )}
      {(error === undefined || assembledText) && (
        <div>
          <div className="sse-section-head">
            <span>{t(`回复（${events.length} 个事件${done ? ' · 已结束' : ''}）`,
              `Answer (${events.length} ${events.length === 1 ? 'event' : 'events'}${done ? ' · Done' : ''})`)}</span>
            <div className="sse-answer-actions">
              <div className="segmented">
                <button className={!markdown ? 'active' : ''} aria-pressed={!markdown} onClick={() => setMarkdown(false)}>
                  {t('文本', 'Text')}
                </button>
                <button className={markdown ? 'active' : ''} aria-pressed={markdown} onClick={() => setMarkdown(true)}>{t('Markdown', 'Markdown')}</button>
              </div>
              <CopyButton text={assembledText} label={t('复制回复', 'Copy answer')} />
            </div>
          </div>
          <div className={`sse-answer-box${markdown ? '' : ' plain-text'}`}>
            {assembledText ? (markdown ? <MarkdownView content={assembledText} /> : assembledText) : (
              <span style={{ color: 'var(--text-muted)' }}>
                {t('暂未解析到回复文本，可切换到「事件流」或「原始」查看。', 'No answer text yet. Open Events or Raw to inspect the stream.')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
