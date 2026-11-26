// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { seedData } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import { kv } from '../src/lib/util';
import { useAppStore } from '../src/store/useAppStore';
import { button, click, typeInput } from './renderComponent';
import { showResponses } from './renderResponsePane';

it('saves the exact previewed output into the request folder, updating an existing variable in place', async () => {
  const data = seedData();
  const folder = data.folders[0];
  const existing = { ...kv('access_token', 'previous', false), note: 'keep note' };
  folder.variables = [existing];
  data.settings.activeEnvironment[folder.workspaceId] = data.environments[1].id;
  data.requests[0].responseFilter = '$.data.access_token';
  const value = '  first line\n' + 'x'.repeat(80) + '  ';
  const { container, req, history: [resp] } = showResponses({ data, records: [{ body: JSON.stringify({ data: { access_token: value } }) }] });
  await click(button(container.querySelector('.jq-bar')!, 'Save Var'));
  const dialog = container.querySelector('[role=dialog]')!;
  expect(dialog.querySelector('input')?.value).toBe('access_token');
  expect(dialog.textContent).toContain(`folder "${folder.name}"`);
  expect(dialog.textContent).toContain(value.slice(0, 64) + '…');
  expect(dialog.textContent).not.toContain(value);
  const other = kv('concurrent', 'edit');
  act(() => {
    useAppStore.getState().updateFolder(folder.id, { variables: [existing, other] });
    useAppStore.setState({ histories: { [req.id]: [{ ...resp, body: '{"data":{"access_token":"arrived later"}}' }] } });
  });
  await click(button(dialog, 'Save'));
  const saved = useAppStore.getState();
  expect(saved.data.folders[0].variables).toEqual([{ ...existing, enabled: true, secret: true, value }, other]);
  expect(saved.data.environments[1].variables).toEqual([]);
  expect(saved.toasts.at(-1)).toMatchObject({ kind: 'success', message: `Saved {{access_token}} to folder "${folder.name}"` });
  await act(async () => { await vi.advanceTimersByTimeAsync(320); });
  expect(storage.saveAppData).toHaveBeenCalledWith(saved.data);
});

it('uses the edited variable name for credential detection and the active environment shown in the Chinese prompt', async () => {
  const data = seedData();
  const req = data.requests[0];
  req.folderId = null;
  req.responseFilter = '.data.value';
  const [base, env] = data.environments;
  data.settings.activeEnvironment[req.workspaceId] = env.id;
  const { container } = showResponses({ data, lang: 'zh', records: [{ body: '{"data":{"value":" abc "}}' }] });
  await click(button(container, '存为变量'));
  const dialog = container.querySelector('[role=dialog]')!;
  expect(dialog.textContent).toContain(`环境「${env.name}」`);
  expect(dialog.querySelector('input')!.value).toBe('value');
  typeInput(dialog.querySelector('input')!, '  ocp-apim-subscription-key  ');
  act(() => useAppStore.getState().setActiveEnvironment(null));
  await click(button(dialog, '保存'));
  const saved = useAppStore.getState();
  expect(saved.data.environments.find(e => e.id === env.id)?.variables).toEqual([
    expect.objectContaining({ key: 'ocp-apim-subscription-key', enabled: true, secret: true, value: ' abc ' }),
  ]);
  expect(saved.data.environments.find(e => e.id === base.id)?.variables).toEqual([]);
  expect(saved.toasts.at(-1)).toMatchObject({ kind: 'success', message: `已将 {{ocp-apim-subscription-key}} 保存到环境「${env.name}」` });
});

it('handles cancellation, invalid names and zero values in the workspace base environment', async () => {
  const data = seedData();
  data.requests[0].folderId = 'missing';
  data.requests[0].responseFilter = '.count';
  const { container } = showResponses({ data, records: [{ body: '{"count":0}' }] });
  const open = async () => {
    await click(button(container, 'Save Var'));
    return container.querySelector<HTMLElement>('[role=dialog]')!;
  };
  let dialog = await open();
  expect(dialog.textContent).toContain('Global Variables');
  await click(button(dialog, 'Cancel'));
  expect(useAppStore.getState().data).toBe(data);
  dialog = await open();
  typeInput(dialog.querySelector('input')!, 'a b');
  await click(button(dialog, 'Save'));
  expect(useAppStore.getState().data).toBe(data);
  expect(useAppStore.getState().toasts.at(-1)?.kind).toBe('error');
  await click(button(await open(), 'Save'));
  expect(useAppStore.getState().data.environments[0].variables).toEqual([
    expect.objectContaining({ key: 'count', value: '0', secret: false, enabled: true }),
  ]);
});

it('does not redirect a save if its destination disappears while the prompt is open', async () => {
  const data = seedData();
  const req = data.requests[0];
  req.folderId = null;
  req.responseFilter = '.token';
  const env = data.environments[1];
  data.settings.activeEnvironment[req.workspaceId] = env.id;
  const { container } = showResponses({ data, records: [{ body: '{"token":"value"}' }] });
  await click(button(container, 'Save Var'));
  act(() => useAppStore.getState().deleteEnvironment(env.id));
  await click(button(container.querySelector('[role=dialog]')!, 'Save'));
  expect(useAppStore.getState().data.environments[0].variables).toEqual([]);
  expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ kind: 'error' });
});

it('offers save only for successful, enabled, nonempty filter output outside stream mode', async () => {
  const { container, req, history: [resp] } = showResponses({ records: [{ body: '{"empty":"","spaces":"  "}' }] });
  const bar = container.querySelector('.jq-bar')!;
  const actions = () => [...bar.querySelectorAll('button')].filter(b => b.textContent === 'Save Var');
  const input = bar.querySelector('input')!;
  expect(actions()).toHaveLength(0);
  for (const expr of ['  ', '.bad[', '.empty']) {
    typeInput(input, expr);
    expect(actions()).toHaveLength(0);
  }
  typeInput(input, '.spaces');
  expect(actions()).toHaveLength(1);
  await click(button(bar, 'Raw'));
  expect(actions()).toHaveLength(0);
  await click(button(bar, 'Filtered'));
  expect(actions()).toHaveLength(1);
  act(() => useAppStore.setState({ histories: { [req.id]: [{ ...resp, body: 'data: {}\n\n', contentType: 'text/event-stream' }] } }));
  expect(actions()).toHaveLength(0);
  act(() => useAppStore.setState({ histories: {} }));
  expect(actions()).toHaveLength(0);
});

it('ranks two inline presets, lists all seven with expressions, and closes on selection, outside mousedown and Escape', async () => {
  const { container, req } = showResponses({ records: [{ body: '{"candidates":[{"content":{"parts":[{"text":"answer"}]}}]}' }] });
  const bar = container.querySelector('.jq-bar')!;
  expect([...bar.querySelectorAll('.jq-quick')].map(b => b.textContent)).toEqual(['Gemini', 'AI Reply']);
  expect(bar.querySelectorAll('button')).toHaveLength(3);
  const more = button(bar, 'More presets');
  await click(more);
  const menu = bar.querySelector('.menu-pop.right')!;
  expect(menu.querySelectorAll('button .mono')).toHaveLength(7);
  act(() => menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(more.getAttribute('aria-expanded')).toBe('true');
  act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(bar.querySelector('.menu-pop')).toBeNull();
  await click(more);
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.activeElement).toBe(more);
  expect(more.getAttribute('aria-expanded')).toBe('false');
  await click(more);
  const expr = '.content[0].text // .error.message // .';
  await click(button(bar.querySelector('.menu-pop')!, expr));
  expect(useAppStore.getState().data.requests.find(r => r.id === req.id)?.responseFilter).toBe(expr);
  expect(bar.querySelector('.menu-pop')).toBeNull();
  await click(button(bar, 'Clear filter'));
  expect(bar.querySelector('.menu-pop')).toBeNull();
  await click(button(bar, 'Gemini'));
  expect(container.querySelector('.cm-content')?.textContent).toBe('answer');
});

it('fits the scrollable preset menu inside a short response pane', async () => {
  const { container } = showResponses({ records: [] });
  const pane = container.querySelector<HTMLElement>('.pane')!;
  const trigger = button(pane, 'More presets');
  const anchor = trigger.closest<HTMLElement>('.dropdown-wrap')!;
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 300, 360, 180));
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(520, 375, 20, 22));
  await click(trigger);
  const menu = pane.querySelector<HTMLElement>('.jq-preset-menu')!;
  expect(menu.style.getPropertyValue('--response-menu-height')).toBe('75px');
  expect(menu.querySelectorAll('button')).toHaveLength(7);
  await click(document.body);
  expect(pane.querySelector('.jq-preset-menu')).toBeNull();
});
