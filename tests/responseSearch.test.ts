import { expect, it } from 'vitest';
import { createSearchMatcher, findTextMatches, filterJsonContent, filterLinesContent } from '../src/lib/responseSearch';
import { runFilter } from '../src/lib/jq';

const employee = { adminUserId: '1', departments: [{ departmentName: '项目运营二部', id: 1 }, { departmentName: 'other' }],
  realname: 'Janis', employeeStatus: 'ACTIVE', profile: { lang: 'en' } };
const payload = { code: 200, data: { items: [employee, { adminUserId: '2', realname: 'FYY', departments: [] }] } };
function filter(value: unknown, word: string) {
  const result = filterJsonContent(JSON.stringify(value), s => s.includes(word))!;
  return { value: result.matched ? JSON.parse(result.output) : undefined, count: result.matchedItems };
}

it('retains a complete matching array record and prunes wrapper siblings', () => {
  expect(filter(payload, 'Janis')).toEqual({ value: { data: { items: [employee] } }, count: 1 });
  expect(filter(payload, 'realname')).toEqual({ value: { data: payload.data }, count: 2 });
});
it('preserves primitive sibling order and filters nested arrays within matching groups', () => {
  const match = { adminUserId: '1', departments: [employee.departments[0]], realname: 'Janis', employeeStatus: 'ACTIVE' };
  const result = filterJsonContent(JSON.stringify([{ group: 'east', payload }, { group: 'west' }]), s => s.includes('项目运营二部'))!;
  expect(result.output).toBe(JSON.stringify([{ group: 'east', payload: { data: { items: [match] } } }], null, 2));
  expect(result.matchedItems).toBe(1);
});
it('prunes flat objects, retains matching keys and handles primitive roots and arrays', () => {
  expect(filter({ a: 3, b: true, c: null }, 'true')).toEqual({ value: { b: true }, count: 1 });
  expect(filter({ match: { x: 1 }, other: [] }, 'match').value).toEqual({ match: { x: 1 } });
  expect(filter([null, 'null', 4, false], 'null')).toEqual({ value: [null, 'null'], count: 2 });
  expect(filter(null, 'null')).toEqual({ value: null, count: 1 });
  expect(filter(payload, 'absent')).toEqual({ value: undefined, count: 0 });
  expect(filterJsonContent('broken', () => true)).toBeNull();
});
it('matches literals, case and regex safely and returns line counts', () => {
  const literal = createSearchMatcher('A.');
  const regex = createSearchMatcher('^A.', { regex: true, caseSensitive: true });
  if (!literal.ok || !regex.ok) throw Error('missing matcher');
  expect(['a.', 'AX'].map(literal.test)).toEqual([true, false]);
  expect(filterLinesContent('Ab\r\na.\nAB', regex.test)).toEqual({ matched: true, output: 'Ab\nAB', matchedLines: 2, totalLines: 3 });
  expect(createSearchMatcher('(', { regex: true }).ok).toBe(false);
});
it('counts beyond the range limit without hanging on empty Unicode matches', () => {
  expect(findTextMatches('αββα', /β/g, 1)).toEqual({ matches: [{ from: 1, to: 2 }], total: 2, truncated: true });
  expect(findTextMatches('😀', /(?:)/u).matches).toEqual([{ from: 0, to: 0 }, { from: 2, to: 2 }]);
});
it('supports single quotes and JSONPath equality, inequality and truthy predicates', () => {
  expect(runFilter("'a\\'b'", {})).toEqual(["a'b"]);
  expect(runFilter("$.data.items[?(@.realname == 'Janis')]", payload)).toEqual([employee]);
  expect(runFilter("$[?(@.a != 'b')]", [{ a: 'b' }, { a: 'c' }])).toEqual([{ a: 'c' }]);
  expect(runFilter('$[?(@.flag)]', [{ flag: false }, { flag: true }, {}])).toEqual([{ flag: true }]);
});
