import { TEMPLATE_RE } from './template';
import { splitUrl } from './urlParams';
import { tr } from './translate';
import type { Language } from './types';

function encodeLiteral(value: string): string {
  // curl uses '+' for a space, leaves '~' alone, and escapes '*'.
  return new URLSearchParams([['', value]]).toString().slice(1)
    .replace(/%7E/g, '~').replace(/\*/g, '%2A');
}

export function parseUrlQuery(value: string, warnings: string[], lang: Language = 'zh'): string | undefined {
  if (value.startsWith('+')) return value.slice(1);
  const eq = value.indexOf('=');
  if (eq < 0 && value.includes('@')) {
    warnings.push(tr(lang, '--url-query 引用了文件或标准输入，已跳过此项，请手动补上查询参数',
      '--url-query referenced a file or standard input. Add the skipped query parameter manually.'));
    return undefined;
  }
  const content = value.slice(eq + 1);
  let result = eq > 0 ? value.slice(0, eq + 1) : '';
  let offset = 0;
  for (const match of content.matchAll(TEMPLATE_RE)) {
    result += encodeLiteral(content.slice(offset, match.index)) + match[0];
    offset = match.index + match[0].length;
  }
  if (offset > 0) {
    warnings.push(tr(lang, '--url-query 保留了模板变量。变量值含空格、& 或 # 时，请先对值进行 URL 编码',
      '--url-query preserved template variables. URL-encode values containing spaces, & or #.'));
  }
  return result + encodeLiteral(content.slice(offset));
}

export function appendCurlQuery(url: string, value: string): string {
  const { base, query, hash } = splitUrl(url);
  const separator = query && !query.endsWith('&') ? '&' : '';
  // libcurl normalizes percent escapes in the appended part only.
  const appended = value.replace(/%[\da-f]{2}/gi, (escape) => escape.toLowerCase());
  const joined = (query ?? '') + separator + appended;
  return base + (joined ? '?' + joined : '') + hash;
}
