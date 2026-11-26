// @vitest-environment jsdom
import { act } from 'react';
import { expect, it, vi } from 'vitest';
import * as util from '../src/lib/util';
import { useAppStore } from '../src/store/useAppStore';
import { button, click, typeInput } from './renderComponent';
import { showResponses } from './renderResponsePane';

it('shows positive TTFB independently of token usage and localizes history times', async () => {
  const { container, req, history: [resp] } = showResponses({ records: [{ ttfbMs: 20 }] });
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
  const { container } = showResponses({ records: [{ body }], lang });
  const chip = Array.from(container.querySelectorAll<HTMLElement>('.metric-chip')).find(el => el.textContent?.includes('↑10 ↓3'))!;
  expect(chip.title.split('\n')).toEqual(lang === 'en'
    ? ['Input tokens: 10', 'Output tokens: 3', 'Reasoning tokens: 2', 'Total tokens: 13']
    : ['输入词元：10', '输出词元：3', '推理词元：2', '总词元：13']);
});

it('collapses reasoning, copies each section independently and switches Markdown without losing partial output', async () => {
  const copy = vi.spyOn(util, 'copyText').mockResolvedValue();
  const body = ['data: {"type":"response.reasoning_text.delta","delta":"想💡"}',
    'data: {"type":"response.output_text.delta","delta":"**Done**"}', 'event: error\ndata: interrupted'].join('\n\n');
  const { container } = showResponses({ records: [{ body, contentType: 'text/event-stream' }] });
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

it.each(['en', 'zh'] as const)('copies individual header values after filtering and reports clipboard errors in %s', async lang => {
  const headers: [string, string][] = [
    ['x-request-id', '  req-123  '], ['set-cookie', 'a=first; Secure'], ['set-cookie', 'b=second; HttpOnly'],
  ];
  const { container } = showResponses({ records: [{ headers }], lang });
  const en = lang === 'en';
  await click(button(container, en ? 'Headers3' : '响应头3'));
  const copy = vi.spyOn(util, 'copyText').mockResolvedValue();
  const actions = container.querySelectorAll<HTMLButtonElement>('.response-header-value button');
  expect(actions).toHaveLength(3);
  await click(actions[1]);
  await click(actions[2]);
  expect(copy.mock.calls).toEqual([[headers[1][1]], [headers[2][1]]]);
  typeInput(container.querySelector('.tab-scroll input')!, 'request-id');
  expect(container.querySelectorAll('.response-header-value button')).toHaveLength(1);
  const selected = button(container, en ? 'Copy x-request-id value' : '复制 x-request-id 的值');
  await click(selected);
  expect(copy).toHaveBeenLastCalledWith('  req-123  ');
  expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ kind: 'success', message: en ? 'Copied header value' : '已复制响应头的值' });
  copy.mockRejectedValueOnce(new Error('clipboard'));
  await click(selected);
  expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ kind: 'error', message: en ? 'Could not copy header value' : '无法复制响应头的值' });
});

it('masks shared credential header names until revealed and leaves request metadata readable', async () => {
  const requestHeaders: [string, string][] = [
    ['Proxy-Authorization', 'Basic dXNlcjpwYXNzd29yZA=='], ['x-goog-api-key', 'private-google-key'],
    ['Ocp-Apim-Subscription-Key', 'private-subscription-key'], ['x-subscription-key', 'secondary-subscription-key'],
    ['Cookie', 'session=secret; other=second-secret'], ['Authorization', 'Bearer prefix-{{alias}}-sensitive'],
    ['x-token-count', '32'], ['x-request-id', 'req-42'],
  ];
  const { container } = showResponses({ records: [{ requestHeaders }] });
  await click(button(container, 'Sent Request'));
  const values = () => [...container.querySelectorAll('.kv-table tr td:last-child')].map(td => td.textContent);
  const masked = values();
  expect(masked[0]).toMatch(/^Basic .*•/);
  for (let i = 0; i < 6; i++) {
    expect(masked[i]).toContain('•');
    expect(masked[i]).not.toContain(requestHeaders[i][1]);
  }
  expect(masked[4]).not.toContain('second-secret');
  expect(masked[5]).toBe('Bearer ••••');
  expect(masked.slice(6)).toEqual(['32', 'req-42']);
  await click(button(container, 'Reveal Secrets'));
  expect(values()).toEqual(requestHeaders.map(([, value]) => value));
  await click(button(container, 'Mask Secrets'));
  expect(values()).toEqual(masked);
});
