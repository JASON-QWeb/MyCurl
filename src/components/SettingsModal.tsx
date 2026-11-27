import React, { useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  exportMyCurlJson,
  importApifoxCollection,
  importMyCurlBackup,
  importPostmanCollection,
  isApifoxCollection,
  isMyCurlBackup,
  isPostmanCollection,
} from '../lib/collectionIO';
import { parseCurlCommands } from '../lib/curlParser';
import { useI18n, type Language } from '../lib/i18n';
import { importHarArchive, isHarArchive } from '../lib/harImport';
import { importHttpFile, looksLikeHttpFile } from '../lib/httpFileImport';
import { importOpenApiDocument, isOpenApiDocument } from '../lib/openapiImport';
import { downloadPostmanCollection } from '../lib/postmanExport';
import { hasMaskedSecrets } from '../lib/maskedBackup';
import type { AppData, CurlCopySecretMode } from '../lib/types';
import { IconDownload, IconSettings, IconUpload, IconX } from './Icons';

function KeyboardShortcuts() {
  const { t } = useI18n();
  const rows = [
    ['⌘I / ⌘V / ⌘⇧V', t('打开 cURL 归档，⌘V 可在输入框外直接粘贴', 'Open cURL import, or paste with ⌘V outside an editor')],
    ['⌘K', t('搜索请求、文件夹或命令', 'Search requests, folders, or commands')],
    ['⌘↵', t('发送当前请求', 'Send the active request')],
    ['⌘N', t('新建空白请求', 'Create a blank request')],
    ['⌘L', t('选中当前请求的 URL', 'Select the active request URL')],
    ['⌘D', t('在编辑区外复制当前请求副本', 'Duplicate the active request outside an editor')],
    ['⌘S', t('立即保存到本地', 'Save locally now')],
  ];
  return (
    <details style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim)' }}>
      <summary style={{ cursor: 'pointer' }}>{t('快捷键速查', 'Keyboard Shortcuts')}</summary>
      <table className="md-table" style={{ marginTop: 8 }}>
        <thead><tr><th scope="col">{t('快捷键（⌘ 或 Ctrl）', 'Shortcut (⌘ or Ctrl)')}</th><th scope="col">{t('功能', 'Action')}</th></tr></thead>
        <tbody>{rows.map(([keys, action]) => (
          <tr key={keys}><td><kbd className="kbd">{keys}</kbd></td><td>{action}</td></tr>
        ))}</tbody>
      </table>
    </details>
  );
}

export const SettingsModal: React.FC = () => {
  const {
    data,
    serverInfo, saveAndRecordDownload, revealInFolder,
    settingsModal,
    setSettingsModal,
    updateSettings,
    updateImportSettings,
    replaceData,
    importPostmanEnvironment,
    applyBatchImport,
    confirm,
    toast,
  } = useAppStore();
  const { t } = useI18n();

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!settingsModal) return null;

  const s = data.settings;
  const wsId = s.activeWorkspaceId || data.workspaces[0].id;

  const downloadJson = (maskSecrets: boolean) => {
    const content = exportMyCurlJson(data, maskSecrets);
    void saveAndRecordDownload({ text: content, source: 'backup', mimeType: 'application/json',
      filename: `mycurl-backup${maskSecrets ? '-masked' : ''}-${new Date().toISOString().slice(0, 10)}.json` });
  };

  const finishImport = (format: string, result: { data: AppData; folderCount: number; requestCount: number }) => {
    replaceData(result.data);
    toast(t(
      `已导入 ${format}：${result.folderCount} 个目录，${result.requestCount} 条请求`,
      `Imported ${format}: ${result.folderCount} folders, ${result.requestCount} requests`,
    ), 'success');
    setSettingsModal(false);
  };

  const restoreBackup = async (backup: AppData) => {
    const note = hasMaskedSecrets(backup) ? t('备份中已脱敏的密钥需要重新填写。', ' Masked secrets in this backup must be re-entered.') : '';
    const ok = await confirm({
      title: t('恢复 MyCurl 备份', 'Restore MyCurl Backup'),
      message: t('导入 MyCurl 备份将替换当前全部工作区数据，是否继续？',
        'Importing a MyCurl backup will replace all current workspace data. Continue?') + note,
      confirmLabel: t('继续恢复', 'Restore'), danger: true,
    });
    if (ok) {
      replaceData(backup);
      toast(t('已恢复 MyCurl 备份数据', 'Restored MyCurl backup'), 'success');
      setSettingsModal(false);
    }
  };

  const handleFileImport = async (file: File | null) => {
    if (!file) return;
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      const current = useAppStore.getState().data;
      let json;
      try { json = JSON.parse(text); } catch { /* Try the text formats below. */ }
      if (json !== undefined) {
        if (isApifoxCollection(json)) return finishImport(t('Apifox 集合', 'Apifox collection'), importApifoxCollection(current, wsId, json));
        if (json?._postman_variable_scope === 'environment') {
          if (importPostmanEnvironment(json, wsId)) setSettingsModal(false);
          return;
        }
        if (isPostmanCollection(json)) return finishImport(t('Postman 集合', 'Postman collection'), importPostmanCollection(current, wsId, json));
        if (isOpenApiDocument(json)) return finishImport(json.swagger === '2.0' ? 'Swagger' : 'OpenAPI', importOpenApiDocument(current, wsId, json));
        if (isHarArchive(json)) {
          const result = importHarArchive(current, wsId, json, current.settings.import);
          if (result.requestCount) finishImport('HAR', result);
          else toast(t('HAR 中没有 HTTP(S) 请求', 'The HAR contains no HTTP(S) requests'), 'error');
          return;
        }
        if (isMyCurlBackup(json)) return await restoreBackup(importMyCurlBackup(json));
      } else {
        const curls = parseCurlCommands(text, current.settings.language);
        if (curls.length) {
          applyBatchImport(curls);
          setSettingsModal(false);
          return;
        }
        if (looksLikeHttpFile(text)) return finishImport(t('HTTP 文件', 'HTTP file'), importHttpFile(current, wsId, text, file.name.replace(/\.[^.]+$/, '')));
      }
      toast(t('未识别的文件格式', 'Unrecognized file format'), 'error');
    } catch {
      toast(t('无法导入文件，请检查文件内容。', 'Could not import the file. Check its contents.'), 'error');
    }
  };

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettingsModal(false);
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h2>
            <IconSettings size={16} />
            {t('设置与数据管理', 'Settings & Data')}
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={() => setSettingsModal(false)}>
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-title">{t('界面外观', 'Appearance')}</div>
            <div className="switch-row">
              <div>
                <div>{t('界面语言', 'Language')}</div>
              </div>
              <select
                className="select select-sm"
                value={s.language ?? 'zh'}
                onChange={(e) => updateSettings({ language: e.target.value as Language })}
              >
                <option value="zh">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="switch-row">
              <div>
                <div>{t('主题风格', 'Theme')}</div>
              </div>
              <select
                className="select select-sm"
                value={s.theme}
                onChange={(e) => updateSettings({ theme: e.target.value as 'dark' | 'light' | 'system' })}
              >
                <option value="dark">{t('深色主题', 'Dark')}</option>
                <option value="light">{t('浅色主题', 'Light')}</option>
                <option value="system">{t('跟随系统', 'System')}</option>
              </select>
            </div>
            <div className="switch-row">
              <div>
                <div>{t('代码编辑器字号', 'Editor Font Size')}</div>
              </div>
              <input
                className="input input-sm mono"
                style={{ width: 80 }}
                type="number"
                min={11}
                max={20}
                value={s.editorFontSize}
                onChange={(e) => updateSettings({ editorFontSize: Number(e.target.value) || 13 })}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-title">{t('网络请求默认配置', 'Request Defaults')}</div>
            <div className="switch-row">
              <div>
                <div>{t('超时时间（毫秒）', 'Timeout (ms)')}</div>
                <small>{t('AI 模型推理较慢时建议保持 120000 ms 以上', 'Keep 120000 ms or higher for slow LLM responses')}</small>
              </div>
              <input
                className="input input-sm mono"
                style={{ width: 110 }}
                type="number"
                value={s.timeoutMs}
                onChange={(e) => updateSettings({ timeoutMs: Number(e.target.value) || 120000 })}
              />
            </div>
            <div className="switch-row">
              <div>
                <div>{t('默认校验 SSL 证书', 'Verify SSL Certificates')}</div>
                <small>{t('关闭后可调试自签名 HTTPS 服务', 'Disable to debug self-signed HTTPS endpoints')}</small>
              </div>
              <input
                type="checkbox"
                checked={s.verifySSL}
                onChange={(e) => updateSettings({ verifySSL: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }}
              />
            </div>
            <div className="switch-row">
              <div>
                <div>{t('默认跟随重定向', 'Follow Redirects')}</div>
              </div>
              <input
                type="checkbox"
                checked={s.followRedirects}
                onChange={(e) => updateSettings({ followRedirects: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }}
              />
            </div>
            <div className="switch-row">
              <div>
                <div>{t('HTTP 代理地址', 'HTTP Proxy')}</div>
                <small>{t('留空直连，例如 http://127.0.0.1:7890', 'Leave empty for direct connection, e.g. http://127.0.0.1:7890')}</small>
              </div>
              <input
                className="input input-sm mono"
                style={{ width: 220 }}
                placeholder="http://127.0.0.1:7890"
                value={s.proxy}
                onChange={(e) => updateSettings({ proxy: e.target.value })}
              />
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-title">{t('cURL 智能归档默认行为', 'cURL Smart Import Defaults')}</div>
            <div className="switch-row">
              <div>
                <div>{t('自动收纳密钥为文件夹变量', 'Extract Secrets to Folder Variables')}</div>
                <small>{t('识别 Bearer Token、x-api-key、查询参数 key 等敏感信息', 'Detects Bearer tokens, x-api-key, query keys, etc.')}</small>
              </div>
              <input
                type="checkbox"
                checked={s.import.extractSecrets}
                onChange={(e) => updateImportSettings({ extractSecrets: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }}
              />
            </div>
            <div className="switch-row">
              <div>
                <div>{t('自动提取 Base URL 路由前缀', 'Extract Base URL Prefix')}</div>
                <small>{t('如 https://app.ppapi.us/v1 → {{base_url}}', 'e.g. https://app.ppapi.us/v1 → {{base_url}}')}</small>
              </div>
              <input
                type="checkbox"
                checked={s.import.extractBaseUrl}
                onChange={(e) => updateImportSettings({ extractBaseUrl: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }}
              />
            </div>
            <div className="switch-row">
              <div>
                <div>{t('按域名自动归档到文件夹', 'Group into Folders by Host')}</div>
                <small>{t('同一域名下的多个接口自动归入同一目录，共享变量与文档', 'Requests on the same host share a folder, variables, and docs')}</small>
              </div>
              <input
                type="checkbox"
                checked={s.import.groupByHost}
                onChange={(e) => updateImportSettings({ groupByHost: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }}
              />
            </div>
            <label className="switch-row">
              {t('直接粘贴 cURL 时跳过预览弹窗', 'Skip preview modal on direct paste')}
              <input type="checkbox" checked={s.import.skipPreview}
                onChange={e => updateImportSettings({ skipPreview: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
            </label>
            <label className="switch-row">
              {t('归档后自动发送请求', 'Auto-send request after import')}
              <input type="checkbox" checked={s.import.autoSend}
                onChange={e => updateImportSettings({ autoSend: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
            </label>
            <div className="switch-row">
              <div>
                <div>{t('复制 cURL 时的密钥处理', 'Secrets When Copying cURL')}</div>
                <small>{t('控制一键复制 cURL 与导出代码弹窗的默认密钥模式', 'Default secret handling for quick-copy cURL and code export')}</small>
              </div>
              <select
                className="select select-sm"
                value={s.curlCopySecretMode === 'resolve' ? 'resolve' : 'mask'}
                onChange={(e) => updateSettings({ curlCopySecretMode: e.target.value as CurlCopySecretMode })}
              >
                <option value="mask">{t('密钥脱敏（推荐）', 'Mask secrets (recommended)')}</option>
                <option value="resolve">{t('填充真实明文密钥', 'Include raw secret values')}</option>
              </select>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('本地存储与导入 / 导出', 'Local Storage & Import / Export')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
              {t('本地数据目录：', 'Data directory: ')}
              <code className="mono">{serverInfo?.dataDir ?? t('浏览器 localStorage', 'Browser localStorage')}</code>
              {serverInfo && (
                <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                  (MyCurl v{serverInfo.version} · {serverInfo.runtime === 'rust-tauri' ? `Rust Tauri (${serverInfo.platform}/${serverInfo.arch})` : `Node ${serverInfo.node}`})
                </span>
              )}
            </div>
            {serverInfo?.downloadDir && <div className="download-directory">{t('下载目录：', 'Download directory: ')}
              <code className="mono">{serverInfo.downloadDir}</code><button className="btn btn-sm" onClick={() => revealInFolder(serverInfo.downloadDir!)}>
                {t('打开文件夹', 'Show in Folder')}</button></div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.har,.http,.rest,.txt,.sh,.curl"
                style={{ display: 'none' }}
                onChange={(e) => {
                  handleFileImport(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
              <button className="btn" onClick={() => fileInputRef.current?.click()}>
                <IconUpload size={13} />
                {t('导入集合 / 备份 / 文件', 'Import Collection / Backup / File')}
              </button>
              <button className="btn" onClick={() => downloadJson(true)}>
                <IconDownload size={13} />
                {t('导出备份（密钥脱敏）', 'Export Backup (Masked)')}
              </button>
              <button className="btn" onClick={() => downloadJson(false)}>
                <IconDownload size={13} />
                {t('导出完整备份（含密钥）', 'Export Full Backup')}
              </button>
              <button className="btn" onClick={() => downloadPostmanCollection(data, wsId)}>
                <IconDownload size={13} />
                {t('导出 Postman 集合（脱敏）', 'Export Postman (Masked)')}
              </button>
            </div>
            <small style={{ display: 'block', marginTop: 8, color: 'var(--text-muted)' }}>
              {t('支持 OpenAPI · Postman · Apifox · HAR · .http · MyCurl 备份 · cURL',
                'Supports OpenAPI, Postman, Apifox, HAR, .http, MyCurl Backup, cURL')}
            </small>
          </div>
          <KeyboardShortcuts />
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {t('离线优先 · 零云端上传 · 数据自动备份', 'Offline-first · Zero cloud sync · Local auto-backup')}
          </span>
          <button className="btn btn-primary" onClick={() => setSettingsModal(false)}>
            {t('完成', 'Done')}
          </button>
        </div>
      </div>
    </div>
  );
};
