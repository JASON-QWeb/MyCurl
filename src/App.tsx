import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from './store/useAppStore';
import { looksLikeCurl } from './lib/curlParser';
import { isMacOS, isTauri, readClipboardNative } from './lib/bridge';
import { tr, useI18n } from './lib/i18n';
import { clamp, isDarkTheme } from './lib/util';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { RequestPane } from './components/RequestPane';
import { ResponsePane } from './components/ResponsePane';
import { FolderView } from './components/FolderView';
import { CurlImportModal } from './components/CurlImportModal';
import { EnvModal } from './components/EnvModal';
import { SettingsModal } from './components/SettingsModal';
import { ExportModal } from './components/ExportModal';
import { DocModal } from './components/DocModal';
import { CommandPalette } from './components/CommandPalette';
import { ConfirmDialog } from './components/ConfirmDialog';
import { IconPlus, IconSparkles } from './components/Icons';

function onShortcut(e: KeyboardEvent) {
  if (!e.metaKey && !e.ctrlKey) return;
  const state = useAppStore.getState();
  const key = e.key.toLowerCase();
  if (key === 'k') {
    e.preventDefault();
    state.setCommandPalette(true);
  } else if (key === 'i' || (e.shiftKey && key === 'v')) {
    e.preventDefault();
    state.openImportModal();
  } else if (key === 'enter' && !state.importModal?.open && state.selection?.kind === 'request') {
    e.preventDefault();
    state.sendRequest(state.selection.id);
  } else if (key === 'n' && !e.shiftKey && !document.activeElement?.matches('input, textarea')) {
    e.preventDefault();
    state.createRequest(null);
  } else if (!e.altKey && !e.shiftKey) {
    const lang = state.data.settings.language;
    if (key === 's') {
      e.preventDefault();
      if (e.repeat || !state.loaded) return;
      void state.flushSaveNow().then(saved => {
        if (saved) state.toast(tr(lang, '已保存到本地', 'Saved locally'), 'success');
        else state.toast(tr(lang, '本地保存失败', 'Could not save locally'), 'error');
      });
      return;
    }
    if (key !== 'l' && key !== 'd') return;
    const { selection } = state;
    const modalOpen = state.importModal?.open || state.envModal || state.settingsModal || state.commandPalette ||
      state.exportModal || state.docModal || state.dialog;
    if (modalOpen || selection?.kind !== 'request') return;
    if (key === 'l') {
      const url = document.querySelector<HTMLInputElement>('input[data-url-input="true"]');
      if (url) {
        e.preventDefault();
        url.focus();
        url.select();
      }
    } else {
      const editable = 'input, textarea, [contenteditable], .cm-editor';
      if (document.activeElement?.closest(editable) || (e.target instanceof Element && e.target.closest(editable))) return;
      e.preventDefault();
      if (!e.repeat && state.duplicateRequest(selection.id)) {
        state.toast(tr(lang, '已复制请求副本', 'Duplicated request'), 'success');
      }
    }
  }
}

export const App: React.FC = () => {
  const {
    data,
    loaded,
    selection,
    toasts,
    init,
    createRequest,
    openImportModal,
    setClipboardCurl,
    updateSettings,
    removeToast,
  } = useAppStore();

  const [sidebarWidth, setSidebarWidth] = useState(data.settings.sidebarWidth || 270);
  const [splitRatio, setSplitRatio] = useState(data.settings.responsePaneRatio || 0.5);
  const [dragging, setDragging] = useState<'sidebar' | 'split' | null>(null);
  const [narrowWindow, setNarrowWindow] = useState(() => window.innerWidth <= 900);
  const panesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setNarrowWindow(window.innerWidth <= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (loaded) {
      setSidebarWidth(data.settings.sidebarWidth || 270);
      setSplitRatio(data.settings.responsePaneRatio || 0.5);
    }
  }, [loaded]);

  // 主题同步
  const [sysDark, setSysDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const { lang, t } = useI18n();
  const isDark = isDarkTheme(data.settings.theme, sysDark);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
    if (isTauri() && isMacOS()) {
      document.documentElement.setAttribute('data-macos-overlay', 'true');
    }
  }, [isDark, lang]);

  // 全局快捷键 + 非输入框粘贴 cURL 自动触发归档
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const state = useAppStore.getState();
      if (state.importModal?.open) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable || target.closest('.cm-editor'))) {
        return;
      }
      const text = e.clipboardData?.getData('text') ?? '';
      if (looksLikeCurl(text)) {
        e.preventDefault();
        state.importPastedCurl(text);
      }
    };

    const checkClipboard = async () => {
      const text = await readClipboardNative();
      if (text && looksLikeCurl(text)) setClipboardCurl(text);
    };

    window.addEventListener('keydown', onShortcut);
    window.addEventListener('paste', onPaste);
    window.addEventListener('focus', checkClipboard);
    return () => {
      window.removeEventListener('keydown', onShortcut);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('focus', checkClipboard);
    };
  }, [setClipboardCurl]);

  const isVert = data.settings.layout === 'vertical' || narrowWindow;

  // 拖拽调整侧边栏宽度与双栏比例
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (dragging === 'sidebar') {
        const maxW = Math.min(460, Math.floor(window.innerWidth * 0.42));
        setSidebarWidth(clamp(e.clientX, 195, Math.max(200, maxW)));
      } else if (dragging === 'split' && panesRef.current) {
        const rect = panesRef.current.getBoundingClientRect();
        if (!isVert) {
          setSplitRatio(clamp((e.clientX - rect.left) / rect.width, 0.25, 0.75));
        } else {
          setSplitRatio(clamp((e.clientY - rect.top) / rect.height, 0.25, 0.75));
        }
      }
    };
    const onUp = () => {
      if (dragging === 'sidebar') updateSettings({ sidebarWidth });
      else if (dragging === 'split') updateSettings({ responsePaneRatio: splitRatio });
      setDragging(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, sidebarWidth, splitRatio, isVert, updateSettings]);

  const activeReq = selection?.kind === 'request' ? data.requests.find((r) => r.id === selection.id) ?? null : null;
  const activeFolder = selection?.kind === 'folder' ? data.folders.find((f) => f.id === selection.id) ?? null : null;

  return (
    <div className={`app-shell ${dragging ? 'is-dragging' : ''}`}>
      <TopBar />

      <div className="main-area">
        <Sidebar width={sidebarWidth} />
        <div
          className={`resizer ${dragging === 'sidebar' ? 'dragging' : ''}`}
          onMouseDown={() => setDragging('sidebar')}
        />

        {activeFolder ? (
          <FolderView folder={activeFolder} />
        ) : activeReq ? (
          <div ref={panesRef} className={`workspace-panes ${isVert ? 'vertical' : ''}`}>
            <div
              className="pane-slot"
              style={{
                flex: `0 0 calc(${splitRatio * 100}% - 2px)`,
              }}
            >
              <RequestPane key={activeReq.id} req={activeReq} dark={isDark} />
            </div>
            <div
              className={`resizer ${isVert ? 'resizer-h' : ''} ${dragging === 'split' ? 'dragging' : ''}`}
              onMouseDown={() => setDragging('split')}
            />
            <div className="pane-slot" style={{ flex: '1 1 0%' }}>
              <ResponsePane key={activeReq.id} req={activeReq} dark={isDark} vertical={isVert} />
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <IconSparkles size={32} />
            <h3>{t('欢迎使用 MyCurl', 'Welcome to MyCurl')}</h3>
            <p>
              {t(
                '直接复制 AI 给你的 cURL 命令并按 ',
                'Copy any cURL command and press ',
              )}
              <span className="kbd">⌘V</span>
              {t(
                ' 或点击下方按钮，MyCurl 会自动收纳密钥、路由前缀、请求体与 ',
                ' or click below. MyCurl automatically extracts secrets, base URLs, bodies, and ',
              )}
              <code>jq</code>
              {t(' 筛选表达式并归档为文档。', ' filters into organized collections.')}
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button className="btn btn-primary" onClick={() => openImportModal()}>
                <IconSparkles size={14} />
                {t('粘贴 cURL 智能归档', 'Paste cURL to Import')}
              </button>
              <button className="btn" onClick={() => createRequest(null)}>
                <IconPlus size={14} />
                {t('新建空白请求', 'New Request')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 弹窗 */}
      <CurlImportModal />
      <EnvModal />
      <SettingsModal />
      <ExportModal />
      <DocModal />
      <CommandPalette />
      <ConfirmDialog />

      {/* Toast 提示 */}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => removeToast(t.id)}>
            <span>{t.message}</span>
            {t.action && <button className="btn btn-sm" onClick={e => { e.stopPropagation(); t.action?.onClick(); }}>{t.action.label}</button>}
          </div>
        ))}
      </div>
    </div>
  );
};
