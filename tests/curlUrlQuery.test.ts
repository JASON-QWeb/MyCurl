import { describe, expect, it } from 'vitest';
import { parseCurl } from '../src/lib/curlParser';

describe('curl --url-query', () => {
  const base = 'http://localhost/search';

  it('encodes named, anonymous and bare terms and appends them before the fragment', () => {
    const req = parseCurl(`curl '${base}?q=start#section' --url-query 'q=中文 a+b!' --url-query '=x=y' --url-query 'x~*' --url-query 'q='`)!;
    expect(req.url).toBe(base + '?q=start&q=%e4%b8%ad%e6%96%87+a%2bb%21&x%3dy&x~%2a&q=#section');
    expect(req.method).toBe('GET');
    expect(req.body.type).toBe('none');
  });

  it('preserves pre-encoded names and raw query syntax without double encoding', () => {
    const req = parseCurl(`curl '${base}?v=%2F&#anchor' --url-query '+q=%2F&q=a+b' --url-query 'a%20b=x@y' --url-query 'a@b=x'`)!;
    expect(req.url).toBe(base + '?v=%2F&q=%2f&q=a+b&a%20b=x%40y&a@b=x#anchor');
  });

  it('retains variables and reports file or standard input references', () => {
    const req = parseCurl(`curl '${base}#frag?' --url-query "q=$TERM end" --url-query '@-' --url-query 'name@file' --url-query '+@literal'`)!;
    expect(req.url).toBe(base + '?q={{TERM}}+end&@literal#frag?');
    expect(req.envRefs).toContain('TERM');
    expect(req.warnings.filter((s) => s.includes('文件或标准输入'))).toHaveLength(2);
    expect(req.warnings.some((s) => s.includes('模板变量'))).toBe(true);
  });

  it('keeps POST data independent and follows curl precedence for --get with data', () => {
    const post = parseCurl(`curl '${base}#frag' --url-query 'search=x' -d 'body=1'`)!;
    expect(post).toMatchObject({ method: 'POST', url: base + '?search=x#frag', body: { type: 'form', form: [{ key: 'body', value: '1' }] } });
    for (const flags of ["-G -d 'page=1' --url-query 'ignored=x'", "--url-query 'ignored=x' -G -d 'page=1'"]) {
      expect(parseCurl(`curl '${base}?q=x#frag' ${flags}`)).toMatchObject({ method: 'GET', url: base + '?q=x&page=1#frag', body: { type: 'none' } });
    }
    expect(parseCurl(`curl '${base}?' -G --url-query 'only=1'`)!.url).toBe(base + '?only=1');
  });
});
