import { expect, it } from 'vitest';
import { checkJsonBodySyntax } from '../src/lib/jsonCheck';

it.each([
  '', ' \n\t', 'null', 'false', '123.5', '{"nested":[1,{"active":true}]}',
  '{"{{field}}":"prefix {{name}} and {{另一个}}"}',
  '{"limit": {{limit}}, "stream": {{is_stream}}, "list":[{{ $timestamp }}, {{env.count}}]}',
  '{{body}}', '{"message":"say \\"{{name}}\\"","count":{{count}}}',
  '["ends with a backslash\\\\",{{after}}, "embedded \\\\\\" quote {{in-string}}"]',
])('accepts valid or templated JSON %j', text => {
  expect(checkJsonBodySyntax(text)).toEqual({ ok: true });
});

it.each([
  '{"trailing":true,}', '{"name":"{{name}}}', '["unterminated', '{"name":{{unfinished}',
  '{"a":{{a}} "b":"{{b}}"}', '{"limit":{{not a variable}}}', '{unquoted:1}', '["bad\\q"]',
])('reports a syntax error for %j', text => {
  expect(checkJsonBodySyntax(text)).toEqual({ ok: false, message: expect.stringMatching(/\S/) });
});
