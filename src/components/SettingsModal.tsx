import React, { useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import {
  exportMyCurlJson,
  importMyCurlBackup,
  importPostmanCollection,
  isMyCurlBackup,
  isPostmanCollection,
} from '../lib/collectionIO';
import { parseCurlCommands } from '../lib/curlParser';
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
    applyBatchImport,
    toast,
  } = useAppStore();

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
    toast(maskSecrets ? '已导出脱敏备份 JSON' : '已导出完整备份 JSON', 'success');
  };

  const handleFileImport = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    try {
      const json = JSON.parse(text);
      if (isPostmanCollection(json)) {
        const res = importPostmanCollection(data, wsId, json);
        replaceData(res.data);
        toast(`已导入 Postman 集合：${res.folderCount} 个目录，${res.requestCount} 条请求`, 'success');
        setSettingsModal(false);
        return;
      }
      if (isMyCurlBackup(json)) {
        if (!window.confirm('导入 MyCurl 备份将替换当前全部工作区数据，是否继续？')) return;
        replaceData(importMyCurlBackup(json));
        toast('已恢复 MyCurl 备份数据', 'success');
        setSettingsModal(false);
        return;
      }
    } catch {
      /* 尝试按 cURL 文本文件导入 */
    }
    const curls = parseCurlCommands(text);
    if (curls.length > 0) {
      applyBatchImport(curls);
      setSettingsModal(false);
      return;
    }
    toast('未识别的文件格式（支持 MyCurl JSON、Postman v2.1 JSON 或 cURL 文本文件）', 'error');
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
            设置与数据管理
          </h2>
          <button className="btn btn-ghost btn-icon" onClick={() => setSettingsModal(false)}>
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-title">界面外观</div>
            <div className="switch-row">
              <div>
                <div>主题风格</div>
              </div>
              <select
                className="select select-sm"
                value={s.theme}
                onChange={(e) => updateSettings({ theme: e.target.value as 'dark' | 'light' | 'system' })}
              >
                <option value="dark">深色主题</option>
                <option value="light">浅色主题</option>
                <option value="system">跟随系统</option>
              </select>
            </div>
            <div className="switch-row">
              <div>
                <div>代码编辑器字号</div>
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
            <div className="card-title">网络请求默认配置</div>
            <div className="switch-row">
              <div>
                <div>超时时间（毫秒）</div>
                <small>AI 模型推理较慢时建议保持 120000 ms 以上</small>
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
                <div>默认校验 SSL 证书</div>
                <small>关闭后可调试自签名 HTTPS 服务</small>
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
                <div>默认跟随重定向</div>
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
                <div>HTTP 代理地址</div>
                <small>留空直连，例如 http://127.0.0.1:7890</small>
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
            <div className="card-title">cURL 智能归档默认行为</div>
            <div className="switch-row">
              <div>
                <div>自动收纳密钥为文件夹变量</div>
                <small>识别 Bearer Token、x-api-key、查询参数 key 等敏感信息</small>
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
                <div>自动提取 Base URL 路由前缀</div>
                <small>如 https://app.ppapi.us/v1 → {'{{base_url}}'}</small>
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
                <div>按域名自动归档到文件夹</div>
                <small>同一域名下的多个接口自动归入同一目录，共享变量与文档</small>
              </div>
              <input
                type="checkbox"
                checked={s.import.groupByHost}
                onChange={(e) => updateImportSettings({ groupByHost: e.target.checked })}
                style={{ accentColor: 'var(--accent)' }}
              />
            </div>
          </div>

          <div className="card">
            <div className="card-title">本地存储与导入 / 导出</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10 }}>
              本地数据目录：<code className="mono">{serverInfo?.dataDir ?? '浏览器 localStorage'}</code>
              {serverInfo && (
                <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>
                  （MyCurl v{serverInfo.version} · {serverInfo.runtime === 'rust-tauri' ? `Rust Tauri (${serverInfo.platform}/${serverInfo.arch})` : `Node ${serverInfo.node}`}）
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
                导入 Postman / 备份 / cURL 文件
              </button>
              <button className="btn" onClick={() => downloadJson(true)}>
                <IconDownload size={13} />
                导出备份（密钥脱敏）
              </button>
              <button className="btn" onClick={() => downloadJson(false)}>
                <IconDownload size={13} />
                导出完整备份（含密钥）
              </button>
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>离线优先 · 零云端上传 · 数据自动备份</span>
          <button className="btn btn-primary" onClick={() => setSettingsModal(false)}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
