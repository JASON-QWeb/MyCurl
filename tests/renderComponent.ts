import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, vi } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';

const roots: Root[] = [];
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()));
  document.body.replaceChildren();
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

export function renderComponent(element: ReactElement) {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  roots.push(root);
  const render = (next: ReactElement) => act(() => root.render(next));
  render(element);
  return { container, render };
}

export function button(container: ParentNode, label: string) {
  const match = Array.from(container.querySelectorAll('button')).find(item => item.title === label || item.textContent === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

export async function click(element: HTMLElement) {
  await act(async () => { element.click(); });
}
