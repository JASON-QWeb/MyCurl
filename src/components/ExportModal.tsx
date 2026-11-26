import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { exportAsCurl, exportAsFetch, exportAsPython, generateRequestDoc, type CodeGenOptions } from '../lib/curlExport';
import { exportHttpFile } from '../lib/httpFileExport';
import { copyText } from '../lib/util';
import { useI18n } from '../lib/i18n';
import { IconCode, IconCopy, IconX } from './Icons';

export const ExportModal: React.FC = () => {
  const { data, exportModal, setExportModal, toast } = useAppStore();
  const { t } = useI18n();
  const defaultSecretMode = data.settings.curlCopySecretMode ?? 'mask';
  const [lang, setLang] = useState<'curl' | 'fetch' | 'python' | 'http' | 'markdown'>('curl');
  const [secretMode, setSecretMode] = useState<CodeGenOptions['secretMode']>(defaultSecretMode);
  const [includeJq, setIncludeJq] = useState(true);

  useEffect(() => {
    if (exportModal) {
      setSecretMode(defaultSecretMode);
    }
  }, [exportModal?.requestId, defaultSecretMode]);

  const req = exportModal ? data.requests.find((r) => r.id === exportModal.requestId) : null;

  const http = useMemo(
    () => req && lang === 'http' ? exportHttpFile(data, req, { secretMode }) : null,
    [data, req, lang, secretMode],
  );
  const output = useMemo(() => {
    if (!req) return '';
    const opts: CodeGenOptions = { secretMode, includeJq };
    if (lang === 'curl') return exportAsCurl(data, req, opts);
    if (lang === 'fetch') return exportAsFetch(data, req, opts);
    if (lang === 'python') return exportAsPython(data, req, opts);
    if (lang === 'http') return http?.text ?? '';
    return generateRequestDoc(data, req);
  }, [data, req, lang, secretMode, includeJq, http]);

  if (!req) return null;

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setExportModal(null);
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>
            <IconCode size={16} />
            {t(`生成代码与文档 · ${req.name}`, `Code & Docs · ${req.name}`)}
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={() => setExportModal(null)}>
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            <div className="segmented">
              <button className={lang === 'curl' ? 'active' : ''} onClick={() => setLang('curl')}>
                cURL
              </button>
              <button className={lang === 'fetch' ? 'active' : ''} onClick={() => setLang('fetch')}>
                JavaScript fetch
              </button>
              <button className={lang === 'python' ? 'active' : ''} onClick={() => setLang('python')}>
                Python requests
              </button>
              <button className={lang === 'http' ? 'active' : ''} onClick={() => setLang('http')}>
                .http
              </button>
              <button className={lang === 'markdown' ? 'active' : ''} onClick={() => setLang('markdown')}>
                {t('Markdown 文档', 'Markdown')}
              </button>
            </div>

            {lang !== 'markdown' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  className="select select-sm"
                  value={secretMode}
                  onChange={(e) => setSecretMode(e.target.value as CodeGenOptions['secretMode'])}
                >
                  <option value="mask">{t('密钥脱敏显示（推荐）', 'Mask secrets (recommended)')}</option>
                  <option value="template">{t('保留 {{变量}} 占位符', 'Keep {{variable}} placeholders')}</option>
                  <option value="resolve">{t('填充真实明文密钥', 'Include raw secret values')}</option>
                </select>
                {lang === 'curl' && req.responseFilter && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includeJq}
                      onChange={(e) => setIncludeJq(e.target.checked)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    {t('附带 jq 管道', 'Include jq pipe')}
                  </label>
                )}
              </div>
            )}
          </div>

          <pre className="md-pre" style={{ margin: 0, maxHeight: 400, userSelect: 'all' }}>
            <code>{http?.error === 'multipart'
              ? t('multipart 请求请使用 cURL 导出。', 'Use cURL to export multipart requests.')
              : http?.error === 'syntax'
                ? t('此请求无法表示为单条 .http 请求，请使用 cURL 导出。', 'This request cannot be represented as a single .http request. Use cURL to export it.')
                : output}</code>
          </pre>
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {secretMode === 'resolve' && lang !== 'markdown'
              ? t('注意：当前包含真实密钥明文，分享前请留意', 'Warning: contains raw secret values — review before sharing')
              : t('已保护敏感密钥', 'Sensitive secrets are protected')}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setExportModal(null)}>
              {t('关闭', 'Close')}
            </button>
            <button
              className="btn btn-primary"
              disabled={!!http?.error}
              onClick={() => {
                copyText(output);
                toast(t('已复制到剪贴板', 'Copied to clipboard'), 'success');
              }}
            >
              <IconCopy size={13} />
              {t('复制内容', 'Copy')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
