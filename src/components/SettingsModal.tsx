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
import type { CurlCopySecretMode } from '../lib/types';
import { IconDownload, IconSettings, IconUpload, IconX } from './Icons';

export const SettingsModal: React.FC = () => {
  const {
    data,
    serverInfo,
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
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mycurl-backup${maskSecrets ? '-masked' : ''}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(
      maskSecrets
        ? t('已导出脱敏备份 JSON', 'Exported masked backup JSON')
        : t('已导出完整备份 JSON', 'Exported full backup JSON'),
      'success',
    );
  };

  const handleFileImport = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      if (isApifoxCollection(json)) {
        const res = importApifoxCollection(data, wsId, json);
        replaceData(res.data);
        toast(
          t(
            `已导入 Apifox 集合：${res.folderCount} 个目录，${res.requestCount} 条请求`,
            `Imported Apifox collection: ${res.folderCount} folders, ${res.requestCount} requests`,
          ),
          'success',
        );
        setSettingsModal(false);
        return;
      }
      if (json?._postman_variable_scope === 'environment') {
        if (importPostmanEnvironment(json, wsId)) setSettingsModal(false);
        return;
      }
      if (isPostmanCollection(json)) {
        const res = importPostmanCollection(data, wsId, json);
        replaceData(res.data);
        toast(
          t(
            `已导入 Postman 集合：${res.folderCount} 个目录，${res.requestCount} 条请求`,
            `Imported Postman collection: ${res.folderCount} folders, ${res.requestCount} requests`,
          ),
          'success',
        );
        setSettingsModal(false);
        return;
      }
      if (isMyCurlBackup(json)) {
        const ok = await confirm({
          title: t('恢复 MyCurl 备份', 'Restore MyCurl Backup'),
          message: t(
            '导入 MyCurl 备份将替换当前全部工作区数据，是否继续？',
            'Importing a MyCurl backup will replace all current workspace data. Continue?',
          ),
          confirmLabel: t('继续恢复', 'Restore'),
          danger: true,
        });
        if (!ok) return;
        replaceData(importMyCurlBackup(json));
        toast(t('已恢复 MyCurl 备份数据', 'Restored MyCurl backup'), 'success');
        setSettingsModal(false);
        return;
      }
    } catch {
      /* 尝试按 cURL 文本文件导入 */
    }
    const curls = parseCurlCommands(text, s.language);
    if (curls.length > 0) {
      applyBatchImport(curls);
      setSettingsModal(false);
      return;
    }
    toast(
      t(
        '未识别的文件格式（支持 Apifox JSON、Postman 集合或环境、MyCurl 备份或 cURL 文本）',
        'Unrecognized file format (supports Apifox JSON, Postman collections or environments, MyCurl backup, or cURL text)',
      ),
      'error',
    );
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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.txt,.sh,.curl"
                style={{ display: 'none' }}
                onChange={(e) => {
                  handleFileImport(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
              <button className="btn" onClick={() => fileInputRef.current?.click()}>
                <IconUpload size={13} />
                {t('导入 Apifox / Postman / 备份 / cURL', 'Import Apifox / Postman / Backup / cURL')}
              </button>
              <button className="btn" onClick={() => downloadJson(true)}>
                <IconDownload size={13} />
                {t('导出备份（密钥脱敏）', 'Export Backup (Masked)')}
              </button>
              <button className="btn" onClick={() => downloadJson(false)}>
                <IconDownload size={13} />
                {t('导出完整备份（含密钥）', 'Export Full Backup')}
              </button>
            </div>
          </div>
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
