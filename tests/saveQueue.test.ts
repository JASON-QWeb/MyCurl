import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as storage from '../src/lib/storage';
import { useAppStore } from '../src/store/useAppStore';
import { importWorkspace } from './importWorkspace';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(storage, 'saveAppData').mockResolvedValue();
  useAppStore.setState({ data: importWorkspace().data, loaded: true });
});
afterEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('flushes the newest debounced snapshot immediately and writes again even when idle', async () => {
  const state = useAppStore.getState();
  state.updateSettings({ theme: 'light' });
  state.updateSettings({ layout: 'vertical' });
  const latest = useAppStore.getState().data;
  expect(storage.saveAppData).not.toHaveBeenCalled();
  expect(await state.flushSaveNow()).toBe(true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(storage.saveAppData).toHaveBeenCalledTimes(1);
  expect(storage.saveAppData).toHaveBeenCalledWith(latest);
  expect(await state.flushSaveNow()).toBe(true);
  expect(storage.saveAppData).toHaveBeenCalledTimes(2);
});

it('serializes overlapping automatic and manual writes and recovers from an earlier failure', async () => {
  const { updateSettings, flushSaveNow } = useAppStore.getState();
  const save = vi.mocked(storage.saveAppData);
  let fail!: (error: Error) => void;
  save.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
  updateSettings({ theme: 'light' });
  await vi.advanceTimersByTimeAsync(320);
  expect(save).toHaveBeenCalledTimes(1);
  updateSettings({ theme: 'dark' });
  const manual = flushSaveNow();
  updateSettings({ theme: 'system' });
  await vi.advanceTimersByTimeAsync(320);
  expect(save).toHaveBeenCalledTimes(1);
  expect(useAppStore.getState().saving).toBe(true);
  fail(new Error('first write failed'));
  expect(await manual).toBe(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(save.mock.calls.map(([data]) => data.settings.theme)).toEqual(['light', 'dark', 'system']);
  expect(useAppStore.getState()).toMatchObject({ saving: false, saveError: null });
});

it('returns false on a failed manual write and clears the error after retry', async () => {
  vi.mocked(storage.saveAppData).mockRejectedValueOnce(new Error('write failed'));
  expect(await useAppStore.getState().flushSaveNow()).toBe(false);
  expect(useAppStore.getState()).toMatchObject({ saving: false, saveError: 'write failed' });
  expect(await useAppStore.getState().flushSaveNow()).toBe(true);
  expect(useAppStore.getState()).toMatchObject({ saving: false, saveError: null });
});
