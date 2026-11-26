import { describe, expect, it } from 'vitest';
import { parseDotEnv, readDotEnvEnvironment } from '../src/lib/dotenvImport';

describe('dotenv assignments', () => {
  it('handles BOM, CRLF, export, whitespace, empty values and inline comments', () => {
    const text = [
      '\uFEFF  # setup', '', '  export\tHOST = https://localhost/path#part\t # comment',
      'HASH=#literal', 'COMMENT=  # empty', 'EMPTY=', '\t PORT = 4321 ',
      'QUERY=key=a=b#fragment # ignored', 'SKIP THIS', '=no-key',
    ].join('\r\n');
    const vars = parseDotEnv(text);
    expect(vars.map(v => [v.key, v.value])).toEqual([
      ['HOST', 'https://localhost/path#part'], ['HASH', '#literal'], ['COMMENT', ''],
      ['EMPTY', ''], ['PORT', '4321'], ['QUERY', 'key=a=b#fragment'],
    ]);
    expect(vars.every(v => v.enabled && v.id)).toBe(true);
    expect(new Set(vars.map(v => v.id)).size).toBe(vars.length);
  });

  it('keeps single quotes literal and decodes only supported escapes in double quotes', () => {
    const vars = parseDotEnv([
      "SINGLE='  one\\n\\t \" # \\\\  ' # outside",
      'DOUBLE="  one\\ntwo\\r\\t\\"ok\\"\\\\end\\q # inside  " # outside',
      'PLAIN=one\\ntwo', 'EMPTY=""',
    ].join('\n'));
    expect(vars.map(v => v.value)).toEqual([
      '  one\\n\\t " # \\\\  ', '  one\ntwo\r\t"ok"\\end\\q # inside  ', 'one\\ntwo', '',
    ]);
  });

  it('reads multiline quoted values without interpreting their contents as assignments', () => {
    const vars = parseDotEnv("SINGLE='line one\r\nINNER=two'\r\nDOUBLE=\"a\n#b\"\nLAST=three");
    expect(vars.map(v => [v.key, v.value])).toEqual([
      ['SINGLE', 'line one\nINNER=two'], ['DOUBLE', 'a\n#b'], ['LAST', 'three'],
    ]);
  });

  it('keeps first-seen order, applies the last value, and marks credential keys', () => {
    const vars = parseDotEnv('API_KEY=first\nHOST=local\nACCESS_TOKEN=token\nexport API_KEY=last');
    expect(vars.map(v => [v.key, v.value, v.secret])).toEqual([
      ['API_KEY', 'last', true], ['HOST', 'local', false], ['ACCESS_TOKEN', 'token', true],
    ]);
  });

  it('skips malformed rows and returns null when the file has no valid assignments', () => {
    const invalid = "# comment\n9BAD=1\nno entry\nBAD='unclosed";
    expect(readDotEnvEnvironment(invalid, 'workspace')).toBeNull();
    expect(parseDotEnv(invalid + '\nGOOD=2')).toMatchObject([{ key: 'GOOD', value: '2' }]);
  });
});

it.each([
  ['.env.staging', 'staging'], ['.env.local', 'local'], ['prod.env', 'prod'], ['.env', '.env'],
  ['configs/.env.qa', 'qa'], ['windows\\dev.env', 'dev'], ['settings.txt', 'settings'], [undefined, '.env'],
])('names the environment from %s', (fileName, name) => {
  const env = readDotEnvEnvironment('PORT=4321', 'workspace', fileName);
  expect(env).toMatchObject({ name, workspaceId: 'workspace', isBase: false, variables: [{ key: 'PORT', value: '4321' }] });
});
