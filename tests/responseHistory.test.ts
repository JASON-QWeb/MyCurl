// @vitest-environment jsdom
import { act } from 'react';
import { expect, it } from 'vitest';
import { seedData } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import { useAppStore } from '../src/store/useAppStore';
import { button, click } from './renderComponent';
import { showResponses } from './renderResponsePane';

const records = [
  { body: 'head\nnew\ntail\nextra', timeMs: 280, contentType: 'text/plain' },
  { body: 'head\nold\ntail', timeMs: 420, status: 201, contentType: 'text/plain' },
];

async function startDiff(container: Element) {
  await click(button(container, 'Response history'));
  await click(button(container.querySelector('.response-history-menu')!, 'Diff'));
  return container.querySelector<HTMLElement>('.response-diff')!;
}

it('opens a baseline from another tab, keeps the current selection, and restores the editor on exit', async () => {
  const { container, req, history } = showResponses({ records: [...records, { body: '', contentType: 'application/octet-stream' }] });
  const status = container.querySelector('.resp-status-bar')!;
  expect(status.querySelectorAll('button')).toHaveLength(3);
  await click(button(container, 'Sent Request'));
  await click(button(status, 'Response history'));
  const rows = container.querySelectorAll('.response-history-row');
  expect([...rows].map(r => !!r.querySelector('.response-history-diff'))).toEqual([false, true, false]);
  await click(button(rows[1], 'Diff'));
  expect(useAppStore.getState().activeResponseId[req.id]).toBe(history[0].id);
  expect(container.querySelector('.tab-btn.active')?.textContent).toBe('Body');
  expect(status.querySelector('.menu-pop')).toBeNull();
  const panel = container.querySelector('.response-diff')!;
  expect(panel.querySelector('[title="Baseline response"]')?.textContent).toBe('201');
  expect(panel.querySelector('[title="Current response"]')?.textContent).toBe('200');
  expect(panel.querySelector('.metric-chip')?.textContent).toContain('420 ms → 280 ms (-140 ms)');
  expect(panel.querySelector('.response-diff-counts')?.textContent).toBe('+2 / -1');
  expect([...panel.querySelectorAll('.add .line-text')].map(el => el.textContent)).toEqual(['new', 'extra']);
  expect(panel.querySelector('.del .line-text')?.textContent).toBe('old');
  expect(container.querySelector('.cm-editor')).toBeNull();
  await click(button(panel, 'Exit Diff'));
  expect(container.querySelector('.response-diff')).toBeNull();
  expect(container.querySelector('.cm-content')?.textContent).toContain('new');
  expect(status.querySelectorAll('button')).toHaveLength(3);
});

it('closes history on outside mousedown or Escape, and keeps presses inside the menu active', async () => {
  const { container } = showResponses({ records });
  const trigger = button(container, 'Response history');
  await click(trigger);
  act(() => container.querySelector('.response-history-row')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(container.querySelector('.response-history-menu')).toBeNull();
  await click(trigger);
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('exits when selecting the baseline, including after selecting the original current entry again', async () => {
  const { container, req, history } = showResponses({ records });
  await startDiff(container);
  await click(button(container, 'Response history'));
  await click(container.querySelectorAll<HTMLButtonElement>('.response-history-row .menu-item')[1]);
  expect(useAppStore.getState().activeResponseId[req.id]).toBe(history[1].id);
  expect(container.querySelector('.response-diff')).toBeNull();
  act(() => useAppStore.getState().selectResponse(req.id, history[0].id));
  expect(container.querySelector('.response-diff')).toBeNull();
});

it('exits when deleting the baseline and stays closed if history is reloaded', async () => {
  const { container, req, history } = showResponses({ records });
  await startDiff(container);
  await click(button(container, 'Response history'));
  await click(button(container.querySelectorAll('.response-history-row')[1], 'Delete entry'));
  expect(storage.deleteHistoryItem).toHaveBeenCalledWith(req.id, history[1].id);
  expect(container.querySelector('.response-diff')).toBeNull();
  expect(useAppStore.getState().histories[req.id]).toHaveLength(1);
  act(() => useAppStore.setState({ histories: { [req.id]: history } }));
  expect(container.querySelector('.response-diff')).toBeNull();
});

it('resets on request change even when imported histories reuse the same response IDs', async () => {
  const data = seedData();
  const { container, req, history, switchRequest } = showResponses({ records, data });
  await startDiff(container);
  const other = data.requests[1];
  act(() => useAppStore.setState({ histories: { [req.id]: history, [other.id]: history.map(h => ({ ...h, requestId: other.id })) } }));
  switchRequest(other.id);
  expect(container.querySelector('.response-diff')).toBeNull();
  switchRequest(req.id);
  expect(container.querySelector('.response-diff')).toBeNull();
});

it.each([{ contentType: 'image/svg+xml' }, { contentType: 'application/pdf' }, { bodyBase64: 'AA==' }])(
  'omits all diff actions when the current record is an image or binary (%o)', async fields => {
    const { container } = showResponses({ records: [{ ...records[0], ...fields }, records[1]] });
    await click(button(container, 'Response history'));
    expect(container.querySelectorAll('.response-history-row')).toHaveLength(2);
    expect(container.querySelector('.response-history-diff')).toBeNull();
  },
);

it.each(['zh', 'en'] as const)('keeps metadata and zero counts for identical bodies in %s', async lang => {
  const { container } = showResponses({ records: [{ body: 'same', timeMs: 100 }, { body: 'same', timeMs: 50, status: 404 }], lang });
  const en = lang === 'en';
  await click(button(container, en ? 'Response history' : '查看历史响应'));
  await click(button(container, en ? 'Diff' : '对比'));
  const panel = container.querySelector('.response-diff')!;
  expect(panel.querySelector('.empty-state')?.textContent).toBe(en ? 'Response bodies are identical' : '两次响应正文完全一致');
  expect(panel.querySelector('.status-4xx')?.textContent).toBe('404');
  expect(panel.querySelector('.metric-chip')?.textContent).toContain('50 ms → 100 ms (+50 ms)');
  expect(panel.querySelector('.response-diff-counts')?.textContent).toBe('+0 / -0');
  await click(button(panel, en ? 'Exit Diff' : '退出对比'));
  expect(container.querySelector('.response-diff')).toBeNull();
});

it('compares full formatted bodies independently of the current jq filter and distinguishes formatting-only changes', async () => {
  const data = seedData();
  data.requests[0].responseFilter = '.id';
  const { container, req, history } = showResponses({ data, records: [{ body: '{"id":1,"n":2}' }, { body: '{"id":1,"n":1}' }] });
  const panel = await startDiff(container);
  expect(panel.querySelector('.add .line-text')?.textContent).toBe('  "n": 2');
  act(() => useAppStore.setState({ histories: { [req.id]: [history[0], { ...history[1], body: '{ "id": 1, "n": 2 }' }] } }));
  expect(panel.querySelector('.empty-state')?.textContent).toBe('Compared response text is identical');
});

it('identifies matching stored excerpts when a response was truncated during capture', async () => {
  const { container } = showResponses({ records: [{ body: 'prefix', bodyTruncated: true }, { body: 'prefix' }] });
  const panel = await startDiff(container);
  expect(panel.querySelector('.response-diff-note')?.textContent).toContain('captured body excerpts');
  expect(panel.querySelector('.empty-state')?.textContent).toBe('Compared response text is identical');
});

it('compares assembled stream answers and can return to a failed current request', async () => {
  const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
  const { container, req, history } = showResponses({ records: ['after', 'before'].map(s => ({ body: sse(s), contentType: 'text/event-stream' })) });
  const panel = await startDiff(container);
  expect(panel.querySelector('.add .line-text')?.textContent).toBe('after');
  expect(panel.querySelector('.del .line-text')?.textContent).toBe('before');
  act(() => useAppStore.setState({ histories: { [req.id]: [{ ...history[0], error: 'Disconnected', status: 0, body: '' }, history[1]] } }));
  expect(panel.querySelector('.status-err')?.textContent).toBe('ERR');
  await click(button(panel, 'Exit Diff'));
  expect(container.querySelector('.error-card')?.textContent).toContain('Disconnected');
});

it('shows the replacement summary for oversized changes and bounds rendered rows for a localized edit', async () => {
  const before = Array.from({ length: 5000 }, (_, i) => String(i));
  const { container, req, history } = showResponses({ records: [{ body: before.map(s => '+' + s).join('\n') }, { body: before.join('\n') }] });
  const panel = await startDiff(container);
  expect(panel.querySelector('.response-diff-note')?.textContent).toContain('replacement');
  expect(panel.querySelector('.response-diff-counts')?.textContent).toBe('+5000 / -5000');
  expect(panel.querySelectorAll('.response-diff-line').length).toBeLessThan(100);
  before[2500] = 'changed';
  act(() => useAppStore.setState({ histories: { [req.id]: [{ ...history[0], body: before.join('\n') }, history[1]] } }));
  expect(panel.querySelector('.response-diff-note')).toBeNull();
  expect(panel.querySelector('.response-diff-counts')?.textContent).toBe('+1 / -1');
  expect(panel.querySelectorAll('.response-diff-line').length).toBeLessThan(100);
  expect(panel.querySelector('.add .line-number:nth-child(2)')?.textContent).toBe('2501');
});
