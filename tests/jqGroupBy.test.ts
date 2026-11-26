import { describe, expect, it } from 'vitest';
import { applyFilterToText, runFilter } from '../src/lib/jq';

describe('jq group_by', () => {
  it('sorts by every output of the grouping filter and keeps original order within a group', () => {
    const rows = [
      { status: 404, path: '/', n: 0 }, { status: 200, path: '/b', n: 1 },
      { status: 200, path: '/a', n: 2 }, { status: 200, path: '/b', n: 3 },
    ];
    const filter = 'group_by(.status, .path) | map(map(.n))';
    expect(applyFilterToText(filter, JSON.stringify(rows))).toEqual({
      ok: true, output: JSON.stringify([[2], [1, 3], [0]], null, 2),
    });
  });

  it('uses jq type precedence, Unicode code points, and numeric array ordering', () => {
    const keys = [[10], '𐀀', true, {}, false, '\ue000', null, [2], 1, []];
    expect(runFilter('group_by(.)', keys)).toEqual([
      [null, false, true, 1, '\ue000', '𐀀', [], [2], [10], {}].map(k => [k]),
    ]);
  });

  it('compares sorted object keys before their values and ignores insertion order', () => {
    const rows = [{ a: 0, b: [10] }, { b: 0 }, { a: 9 }, { b: [10], a: 0 }, { b: [2], a: 0 }];
    expect(runFilter('group_by(.)', rows)).toEqual([[[rows[2]], [rows[4]], [rows[0], rows[3]], [rows[1]]]]);
  });

  it('supports empty streams, missing fields and empty input arrays', () => {
    expect(runFilter('group_by(.[]?)', [[], [null], [], [null, null]])).toEqual([[[[], []], [[null]], [[null, null]]]]);
    expect(runFilter('group_by(.key)', [{}, { key: null }])).toEqual([[[{}, { key: null }]]]);
    expect(runFilter('group_by(empty)', [])).toEqual([[]]);
  });

  it('rejects invalid inputs through the response filter entry point', () => {
    for (const value of ['"abc"', '{}', 'null', '42']) expect(applyFilterToText('group_by(.)', value).ok).toBe(false);
    expect(applyFilterToText('group_by(.a; .b)', '[]').ok).toBe(false);
  });
});
