// @vitest-environment jsdom
import { createElement } from 'react';
import { expect, it } from 'vitest';
import { Sidebar } from '../src/components/Sidebar';
import { newFolder, newRequest, newWorkspace } from '../src/lib/factory';
import { useAppStore } from '../src/store/useAppStore';
import { importWorkspace } from './importWorkspace';
import { button, click, renderComponent, typeInput } from './renderComponent';

it.each(['en', 'zh'] as const)('collapses and expands all levels of the current workspace in %s', async lang => {
  const { data, ws } = importWorkspace(lang);
  const other = newWorkspace();
  const parent = newFolder(ws, null, { name: 'Outer' });
  const child = newFolder(ws, parent.id, { name: 'Inner' });
  const sibling = newFolder(ws, null);
  const external = newFolder(other.id, null);
  const req = newRequest(ws, child.id, { name: 'Nested request' });
  data.workspaces.push(other);
  data.folders = [parent, child, sibling, external];
  data.requests = [req];
  const selection = { kind: 'request' as const, id: req.id };
  useAppStore.setState({ data, selection, expandedFolders: { [parent.id]: true, [child.id]: true, [external.id]: true } });
  const { container } = renderComponent(createElement(Sidebar, { width: 195 }));
  const footer = container.querySelector('.sidebar-footer')!;
  const collapse = button(footer, lang === 'zh' ? '折叠所有文件夹' : 'Collapse all folders');
  expect(collapse.textContent).toBe(lang === 'zh' ? '折叠' : 'Collapse');
  expect(container.querySelector('.tree-scroll')?.textContent).toContain(req.name);
  await click(collapse);
  const expanded = () => useAppStore.getState().expandedFolders;
  expect(expanded()).toEqual({ [parent.id]: false, [child.id]: false, [sibling.id]: false, [external.id]: true });
  expect(container.querySelector('.tree-scroll')?.textContent).not.toContain(child.name);

  const input = container.querySelector<HTMLInputElement>('.sidebar-search input')!;
  typeInput(input, req.name);
  expect(footer.querySelector('button')).toBeNull();
  expect(container.querySelector('.tree-scroll')?.textContent).toContain(req.name);
  typeInput(input, '');
  expect(container.querySelector('.tree-scroll')?.textContent).not.toContain(req.name);
  const expand = button(footer, lang === 'zh' ? '展开所有文件夹' : 'Expand all folders');
  expect(expand.textContent).toBe(lang === 'zh' ? '展开' : 'Expand');
  await click(expand);
  expect(expanded()).toEqual({ [parent.id]: true, [child.id]: true, [sibling.id]: true, [external.id]: true });
  expect(container.querySelector('.tree-scroll')?.textContent).toContain(req.name);
  expect(useAppStore.getState().selection).toBe(selection);
  expect(useAppStore.getState().data).toBe(data);
});

it('omits the toggle when only other workspaces have folders', () => {
  const { data } = importWorkspace();
  const other = newWorkspace();
  data.workspaces.push(other);
  data.folders = [newFolder(other.id, null)];
  useAppStore.setState({ data });
  const { container } = renderComponent(createElement(Sidebar, { width: 270 }));
  expect(container.querySelector('.sidebar-footer button')).toBeNull();
});
