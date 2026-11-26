// @vitest-environment jsdom
import { act, createElement } from 'react';
import { expect, it, vi } from 'vitest';
import { ResponsePane } from '../src/components/ResponsePane';
import { seedData } from '../src/lib/factory';
import type { Language, ResponseRecord } from '../src/lib/types';
import * as util from '../src/lib/util';
import { useAppStore } from '../src/store/useAppStore';
import { button, click, renderComponent } from './renderComponent';

function showResponse(fields: Partial<ResponseRecord>, language: Language = 'en') {
  const data = seedData();
  data.settings.language = language;
  const req = data.requests[0];
  const resp: ResponseRecord = { id: 'response', requestId: req.id, createdAt: Date.now(), method: req.method,
    url: req.url, status: 200, statusText: 'OK', headers: [], body: '{}', contentType: 'application/json',
    size: 2, timeMs: 75, ...fields };
  useAppStore.setState({ data, histories: { [req.id]: [resp] } });
  return { ...renderComponent(createElement(ResponsePane, { req, dark: true })), req, resp };
}

it('shows positive TTFB independently of token usage and localizes history times', async () => {
  const { container, req, resp } = showResponse({ ttfbMs: 20 });
  const status = container.querySelector('.status-group')!;
  expect(status.textContent).toContain('TTFB 20 ms');
  expect(status.querySelector('[title*="Time to First Byte"]')).toBeTruthy();
  expect(status.textContent).not.toContain('tok');
  await click(button(container, 'Response history'));
  expect(container.querySelector('.menu-pop')?.textContent).toContain('Just now');
  act(() => useAppStore.setState({ histories: { [req.id]: [{ ...resp, ttfbMs: 0, body: '{"usage":{"total_tokens":0}}' }] } }));
  expect(status.textContent).not.toContain('TTFB');
  expect(status.textContent).toContain('0 tok');
});

it.each(['zh', 'en'] as const)('renders a detailed %s tooltip only for reported AI usage', lang => {
  const body = JSON.stringify({ usage: { input_tokens: 10, output_tokens: 3, output_tokens_details: { reasoning_tokens: 2 } } });
  const { container } = showResponse({ body }, lang);
  const chip = Array.from(container.querySelectorAll<HTMLElement>('.metric-chip')).find(el => el.textContent?.includes('↑10 ↓3'))!;
  expect(chip.title.split('\n')).toEqual(lang === 'en'
    ? ['Input tokens: 10', 'Output tokens: 3', 'Reasoning tokens: 2', 'Total tokens: 13']
    : ['输入词元：10', '输出词元：3', '推理词元：2', '总词元：13']);
});

it('collapses reasoning, copies each section independently and switches Markdown without losing partial output', async () => {
  const copy = vi.spyOn(util, 'copyText').mockResolvedValue();
  const body = ['data: {"type":"response.reasoning_text.delta","delta":"想💡"}',
    'data: {"type":"response.output_text.delta","delta":"**Done**"}', 'event: error\ndata: interrupted'].join('\n\n');
  const { container } = showResponse({ body, contentType: 'text/event-stream' });
  const toggle = button(container, 'Reasoning (2 chars)');
  const reasoning = container.querySelector<HTMLElement>('.sse-reasoning')!;
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  await click(toggle);
  expect(reasoning.hidden).toBe(true);
  await click(button(container, 'Copy reasoning'));
  expect(copy).toHaveBeenLastCalledWith('想💡');
  expect(reasoning.hidden).toBe(true);
  await click(toggle);
  expect(reasoning.hidden).toBe(false);
  expect(container.querySelector('.sse-answer-box.plain-text')?.textContent).toBe('**Done**');
  await click(button(container, 'Markdown'));
  expect(container.querySelector('.sse-answer-box .md-view strong')?.textContent).toBe('Done');
  expect(container.querySelector('.sse-answer-box.plain-text')).toBeNull();
  await click(button(container, 'Copy answer'));
  expect(copy).toHaveBeenLastCalledWith('**Done**');
  await click(button(container, 'Text'));
  expect(container.querySelector('.sse-answer-box.plain-text')?.textContent).toBe('**Done**');
  expect(container.querySelector('.jq-error[role="alert"]')?.textContent).toBe('Stream error: interrupted');
});
