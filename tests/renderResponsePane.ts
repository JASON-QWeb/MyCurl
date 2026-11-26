import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, vi } from 'vitest';
import { ConfirmDialog } from '../src/components/ConfirmDialog';
import { ResponsePane } from '../src/components/ResponsePane';
import { seedData } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import type { AppData, Language, ResponseRecord } from '../src/lib/types';
import { useAppStore } from '../src/store/useAppStore';
import { renderComponent } from './renderComponent';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(storage, 'saveAppData').mockResolvedValue();
  vi.spyOn(storage, 'deleteHistoryItem').mockResolvedValue();
});
afterEach(() => vi.useRealTimers());

function Pane({ id }: { id: string }) {
  const req = useAppStore(s => s.data.requests.find(r => r.id === id)!);
  return createElement(Fragment, null, createElement(ResponsePane, { req, dark: true }), createElement(ConfirmDialog));
}

interface Options {
  data?: AppData;
  lang?: Language;
  records?: Partial<ResponseRecord>[];
}

export function showResponses({ data = seedData(), lang = 'en', records = [{}] }: Options = {}) {
  data.settings.language = lang;
  const req = data.requests[0];
  const history: ResponseRecord[] = records.map((fields, i) => ({
    id: `response-${i}`, requestId: req.id, createdAt: Date.now() - 1000 * i, method: req.method,
    url: req.url, status: 200, statusText: 'OK', headers: [], body: '{}', contentType: 'application/json',
    size: 2, timeMs: 75, ...fields,
  }));
  useAppStore.setState({ data, histories: { [req.id]: history }, activeResponseId: { [req.id]: history[0]?.id ?? null } });
  const view = renderComponent(createElement(Pane, { id: req.id }));
  return { container: view.container, req, history, switchRequest: (id: string) => view.render(createElement(Pane, { id })) };
}
