import { afterEach, expect, it, vi } from 'vitest';
import { formatTime, relativeTime } from '../src/lib/util';

afterEach(() => vi.useRealTimers());

it('localizes recent times and keeps older entries in the existing date format', () => {
  vi.useFakeTimers();
  const now = new Date(2025, 6, 15, 12).getTime();
  vi.setSystemTime(now);
  for (const [age, zh, en] of [
    [59_999, '刚刚', 'Just now'], [60_000, '1 分钟前', '1m ago'], [300_000, '5 分钟前', '5m ago'],
    [3_600_000, '1 小时前', '1h ago'], [7_200_000, '2 小时前', '2h ago'],
  ] as const) {
    expect(relativeTime(now - age)).toBe(zh);
    expect(relativeTime(now - age, 'zh')).toBe(zh);
    expect(relativeTime(now - age, 'en')).toBe(en);
  }
  const yesterday = now - 86_400_000;
  expect(relativeTime(yesterday, 'en')).toBe(formatTime(yesterday).slice(0, 16));
});
