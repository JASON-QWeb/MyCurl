import { afterEach, expect, it, vi } from 'vitest';
import * as bridge from '../src/lib/bridge';
import { emptyBody, newRequest, seedData } from '../src/lib/factory';
import { executeRequest } from '../src/lib/requestRunner';
import * as storage from '../src/lib/storage';
import { kv } from '../src/lib/util';
import { useAppStore } from '../src/store/useAppStore';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAppStore.setState(useAppStore.getInitialState(), true);
});

it.each(['en', 'zh'] as const)('blocks unresolved URL variables before either transport with %s guidance', async lang => {
  const data = seedData();
  data.settings.language = lang;
  data.environments[0].variables = [kv('base', '{{ host }}/v1')];
  const req = newRequest(data.workspaces[0].id, null, { url: '{{base}}/{{user}}/{{user}}',
    headers: [kv('Trace', '{{headerOnly}}')], body: { ...emptyBody(), type: 'text', text: '{{bodyOnly}}' },
    auth: { type: 'apikey', in: 'query', key: 'access_token', value: '{{ api_token }}' } });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const invoke = vi.spyOn(bridge, 'tauriInvoke');
  for (const native of [false, true]) {
    vi.spyOn(bridge, 'isTauri').mockReturnValue(native);
    const { error } = await executeRequest(data, req, new AbortController().signal);
    expect(error).toContain(lang === 'en' ? 'red variable chip' : '红色变量标签');
    expect(error?.match(/\{\{\w+\}\}/g)).toEqual(['{{host}}', '{{user}}', '{{api_token}}']);
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
});

it('allows a resolved URL with literal encoded braces and missing non-URL variables', async () => {
  const data = seedData();
  const req = newRequest(data.workspaces[0].id, null, { url: 'https://example.org/?q=%7B%7Bbody%7D%7D',
    headers: [kv('X-Trace', '{{header}}')], body: { ...emptyBody(), type: 'text', text: '{{body}}' } });
  const transport = vi.fn().mockResolvedValue(new Response('{"t":"end"}\n'));
  vi.stubGlobal('fetch', transport);
  expect((await executeRequest(data, req, new AbortController().signal)).error).toBeUndefined();
  expect(transport).toHaveBeenCalledOnce();
});

it.each(['en', 'zh'] as const)('flags pre-aborted and rejected fetches with %s cancellation text', async lang => {
  const data = seedData();
  data.settings.language = lang;
  const fetch = vi.fn().mockRejectedValue(new DOMException('abort', 'AbortError'));
  vi.stubGlobal('fetch', fetch);
  const cancelled = { cancelled: true, error: lang === 'en' ? 'Request cancelled' : '请求已取消' };
  expect(await executeRequest(data, data.requests[0], AbortSignal.abort())).toMatchObject(cancelled);
  expect(fetch).not.toHaveBeenCalled();
  expect(await executeRequest(data, data.requests[0], new AbortController().signal)).toMatchObject(cancelled);
  expect(fetch).toHaveBeenCalledOnce();
});

it('recognizes cancellation while reading a body even with a custom abort reason', async () => {
  const data = seedData();
  data.settings.language = 'en';
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(sink) {
      sink.enqueue(new TextEncoder().encode('{"t":"head","status":200}\n'));
      controller.signal.addEventListener('abort', () => sink.error(controller.signal.reason));
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
  const response = await executeRequest(data, data.requests[0], controller.signal, {
    onUpdate: () => controller.abort(new Error('superseded')),
  });
  expect(response).toMatchObject({ status: 200, cancelled: true, error: 'Request cancelled' });
});

it('cancels only the corresponding native send and localizes an ABORT_ERR channel event', async () => {
  const data = seedData();
  data.settings.language = 'en';
  const req = data.requests[0];
  vi.spyOn(bridge, 'isTauri').mockReturnValue(true);
  const channel = vi.spyOn(bridge, 'createTauriChannel').mockReturnValue({} as ReturnType<typeof bridge.createTauriChannel>);
  const invoke = vi.spyOn(bridge, 'tauriInvoke').mockResolvedValue(undefined);
  const controller = new AbortController();
  const first = executeRequest(data, req, controller.signal);
  const second = executeRequest(data, req, new AbortController().signal);
  controller.abort();
  const [a, b] = invoke.mock.calls.map(([, args]) => args?.payload as { requestId: string });
  expect(a.requestId).not.toBe(b.requestId);
  expect(invoke).toHaveBeenCalledWith('cancel_request', { requestId: a.requestId });
  channel.mock.calls[1][0]({ t: 'error', code: 'ABORT_ERR', message: '请求已取消' });
  for (const result of await Promise.all([first, second])) expect(result).toMatchObject({ cancelled: true, error: 'Request cancelled' });
});

it('uses the cancellation flag for history, independently of error text and timeout codes', async () => {
  const data = seedData();
  data.settings.language = 'en';
  const req = data.requests[0];
  const saved = vi.spyOn(storage, 'saveHistoryItem').mockResolvedValue();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  useAppStore.setState({ data });
  for (const [code, message, cancelled] of [
    ['UND_ERR_ABORTED', 'aborted', true], ['ETIMEDOUT', 'timed out', false], ['HTTP_ERROR', '请求已取消', false],
  ] as const) {
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ t: 'error', code, message }) + '\n'));
    await useAppStore.getState().sendRequest(req.id);
    const record = useAppStore.getState().histories[req.id][0];
    expect(!!record.cancelled).toBe(cancelled);
    expect(record.error).toBe(cancelled ? 'Request cancelled' : message);
    expect(saved.mock.calls.some(([, savedRecord]) => savedRecord.id === record.id)).toBe(!cancelled);
  }
});

it('keeps the latest response selected when a superseded send finishes later', async () => {
  const data = seedData();
  const req = data.requests[0];
  const saved = vi.spyOn(storage, 'saveHistoryItem').mockResolvedValue();
  let finishFirst!: (response: Response) => void;
  const fetch = vi.fn()
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce(new Response('{"t":"head","status":201}\n{"t":"end"}\n'));
  vi.stubGlobal('fetch', fetch);
  useAppStore.setState({ data });
  const first = useAppStore.getState().sendRequest(req.id);
  await useAppStore.getState().sendRequest(req.id);
  finishFirst(new Response('{"t":"end"}\n'));
  await first;
  const state = useAppStore.getState();
  expect(state.histories[req.id]).toHaveLength(1);
  expect(state.histories[req.id][0].status).toBe(201);
  expect(state.activeResponseId[req.id]).toBe(state.histories[req.id][0].id);
  expect(saved).toHaveBeenCalledOnce();
});
