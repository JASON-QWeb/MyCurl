import { useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import type { HttpRequest, ResponseRecord } from '../lib/types';
import { formatMs, methodColor, methodShort } from '../lib/util';
import { useAppStore } from '../store/useAppStore';
import { IconSend, IconStop } from './Icons';
import { ResponseStatusPill } from './ResponseStatusPill';

interface RunProgress {
  currentId: string | null;
  total: number;
  results: Record<string, ResponseRecord>;
}
interface ActiveRun {
  requestId: string;
  controller?: AbortController;
}
const idle: RunProgress = { currentId: null, total: 0, results: {} };

export function useFolderRun(folderId: string) {
  const [progress, setProgress] = useState(idle);
  const active = useRef<ActiveRun | null>(null);

  function cancelActive() {
    const run = active.current;
    active.current = null;
    const { inFlight, cancelRequest } = useAppStore.getState();
    if (run && inFlight[run.requestId]?.controller === run.controller) cancelRequest(run.requestId);
  }
  useLayoutEffect(() => {
    setProgress(idle);
    return cancelActive;
  }, [folderId]);

  async function runAll(requests: HttpRequest[]) {
    if (active.current || !requests.length) return;
    const run: ActiveRun = { requestId: requests[0].id };
    active.current = run;
    let results: RunProgress['results'] = {};
    for (const req of requests) {
      run.requestId = req.id;
      setProgress({ currentId: req.id, total: requests.length, results });
      const pending = useAppStore.getState().sendRequest(req.id);
      run.controller = useAppStore.getState().inFlight[req.id]?.controller;
      const response = await pending;
      if (active.current !== run) return;
      if (response) results = { ...results, [req.id]: response };
    }
    active.current = null;
    setProgress({ currentId: null, total: requests.length, results });
  }
  function stop() {
    cancelActive();
    setProgress(last => ({ ...last, currentId: null }));
  }
  return { progress, runAll, stop };
}

export function FolderRequests({ requests, run }: { requests: HttpRequest[]; run: ReturnType<typeof useFolderRun> }) {
  const { histories, selectRequest, selectResponse } = useAppStore();
  const { t } = useI18n();
  const { currentId, total, results } = run.progress;
  const completed = Object.values(results);
  const done = completed.length;
  const ok = completed.filter(res => !res.error && res.status >= 200 && res.status < 400).length;
  const summary = done ? t(`${ok} 成功 · ${done - ok} 异常`, `${ok} ok · ${done - ok} failed`) : '';
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">
        <span>{t(`已归档接口（${requests.length}）`, `Requests (${requests.length})`)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span role="status" style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
            {currentId ? `${done}/${total}` : summary}
          </span>
          {currentId ? (
            <button className="btn btn-danger btn-sm" onClick={run.stop}><IconStop size={12} />{t('停止', 'Stop')}</button>
          ) : requests.length > 0 && (
            <button className="btn btn-sm" onClick={() => run.runAll(requests)}><IconSend size={12} />{t('运行全部', 'Run All')}</button>
          )}
        </div>
      </div>
      {requests.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('此目录还没有接口', 'No requests in this folder yet')}</div>
      ) : (
        <div className="route-list">
          {requests.map(req => {
            const latest = histories[req.id]?.[0];
            const recorded = results[req.id];
            const response = latest && (!recorded || latest.createdAt >= recorded.createdAt) ? latest : recorded;
            return (
              <button key={req.id} className="route-item" style={{ textAlign: 'left' }} onClick={() => {
                selectRequest(req.id);
                if (response) selectResponse(req.id, response.id);
              }}>
                <span className="method-tag" style={{ color: methodColor(req.method) }}>{methodShort(req.method)}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontWeight: 500 }}>{req.name}</span>
                  <span className="route-url" style={{ display: 'block' }}>{req.url}</span>
                </span>
                {req.responseFilter && <span className="pill pill-info mono" title={`jq: ${req.responseFilter}`}>jq</span>}
                {req.body.type !== 'none' && <span className="pill">{req.body.type.toUpperCase()}</span>}
                {currentId === req.id ? <span className="pill">{t('运行中…', 'Running…')}</span> : response && <>
                  <ResponseStatusPill resp={response} compact />
                  <span className="metric-chip">{formatMs(response.timeMs)}</span>
                </>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
