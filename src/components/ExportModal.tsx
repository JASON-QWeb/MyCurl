import React, { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { exportAsCurl, exportAsFetch, exportAsPython, generateRequestDoc, type CodeGenOptions } from '../lib/curlExport';
import { copyText } from '../lib/util';
import { IconCode, IconCopy, IconX } from './Icons';

export const ExportModal: React.FC = () => {
  const { data, exportModal, setExportModal, toast } = useAppStore();
  const [lang, setLang] = useState<'curl' | 'fetch' | 'python' | 'markdown'>('curl');
  const [secretMode, setSecretMode] = useState<CodeGenOptions['secretMode']>('mask');
  const [includeJq, setIncludeJq] = useState(true);

  const req = exportModal ? data.requests.find((r) => r.id === exportModal.requestId) : null;

  const output = useMemo(() => {
    if (!req) return '';
    const opts: CodeGenOptions = { secretMode, includeJq };
    if (lang === 'curl') return exportAsCurl(data, req, opts);
    if (lang === 'fetch') return exportAsFetch(data, req, opts);
    if (lang === 'python') return exportAsPython(data, req, opts);
    return generateRequestDoc(data, req);
  }, [data, req, lang, secretMode, includeJq]);

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
            生成代码与文档 · {req.name}
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
              <button className={lang === 'markdown' ? 'active' : ''} onClick={() => setLang('markdown')}>
                Markdown 文档
              </button>
            </div>

            {lang !== 'markdown' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <select
                  className="select select-sm"
                  value={secretMode}
                  onChange={(e) => setSecretMode(e.target.value as CodeGenOptions['secretMode'])}
                >
                  <option value="mask">密钥脱敏显示（推荐）</option>
                  <option value="template">保留 {'{{变量}}'} 占位符</option>
                  <option value="resolve">填充真实明文密钥</option>
                </select>
                {lang === 'curl' && req.responseFilter && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={includeJq}
                      onChange={(e) => setIncludeJq(e.target.checked)}
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    附带 jq 管道
                  </label>
                )}
              </div>
            )}
          </div>

          <pre className="md-pre" style={{ margin: 0, maxHeight: 400, userSelect: 'all' }}>
            <code>{output}</code>
          </pre>
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {secretMode === 'resolve' && lang !== 'markdown' ? '注意：当前包含真实密钥明文，分享前请留意' : '已保护敏感密钥'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setExportModal(null)}>
              关闭
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                copyText(output);
                toast('已复制到剪贴板', 'success');
              }}
            >
              <IconCopy size={13} />
              复制内容
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
