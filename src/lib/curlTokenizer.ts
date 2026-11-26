import { tr } from './translate';
import type { Language } from './types';

type Token = { type: 'word'; value: string } | { type: 'op'; value: string };

interface TokenizeCtx {
  envRefs: Set<string>;
  warnings: string[];
  cmdMode: boolean;
  lang?: Language;
}

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function readVar(input: string, i: number, ctx: TokenizeCtx): { text: string; end: number } | null {
  // input[i] === '$'
  const next = input[i + 1];
  if (next === '{') {
    const close = input.indexOf('}', i + 2);
    if (close === -1) return null;
    const inner = input.slice(i + 2, close);
    const name = inner.split(/[:\-=?+#%/]/)[0];
    if (!VAR_NAME.test(name)) return null;
    ctx.envRefs.add(name);
    return { text: `{{${name}}}`, end: close + 1 };
  }
  if (next && /[A-Za-z_]/.test(next)) {
    let j = i + 1;
    while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
    const name = input.slice(i + 1, j);
    ctx.envRefs.add(name);
    return { text: `{{${name}}}`, end: j };
  }
  if (next === '(') {
    // 命令替换 $(...)，保留原文
    let depth = 0;
    let j = i + 1;
    for (; j < input.length; j++) {
      if (input[j] === '(') depth++;
      else if (input[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const text = input.slice(i, j + 1);
    ctx.warnings.push(tr(ctx.lang, `检测到命令替换 ${text}，已按原文保留，请手动替换为实际值`,
      `Command substitution ${text} was kept as text. Replace it with the intended value.`));
    return { text, end: j + 1 };
  }
  return null;
}

function readAnsiC(input: string, i: number): { text: string; end: number } {
  // input[i] === '$', input[i+1] === "'"
  let j = i + 2;
  let out = '';
  while (j < input.length && input[j] !== "'") {
    const c = input[j];
    if (c === '\\' && j + 1 < input.length) {
      const e = input[j + 1];
      j += 2;
      switch (e) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case '0':
          out += '\0';
          break;
        case 'a':
          out += '\x07';
          break;
        case 'b':
          out += '\b';
          break;
        case 'e':
        case 'E':
          out += '\x1b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'v':
          out += '\v';
          break;
        case 'x': {
          const m = /^[0-9a-fA-F]{1,2}/.exec(input.slice(j));
          if (m) {
            out += String.fromCharCode(parseInt(m[0], 16));
            j += m[0].length;
          } else out += '\\x';
          break;
        }
        case 'u':
        case 'U': {
          const m = (e === 'u' ? /^[0-9a-fA-F]{1,4}/ : /^[0-9a-fA-F]{1,8}/).exec(input.slice(j));
          if (m) {
            out += String.fromCodePoint(parseInt(m[0], 16));
            j += m[0].length;
          } else out += '\\' + e;
          break;
        }
        default:
          out += e;
      }
      continue;
    }
    out += c;
    j++;
  }
  return { text: out, end: j + 1 };
}

export function tokenize(input: string, ctx: TokenizeCtx): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let i = 0;
  let cur = '';
  let inWord = false;
  const push = () => {
    if (inWord) {
      tokens.push({ type: 'word', value: cur });
      cur = '';
      inWord = false;
    }
  };

  while (i < n) {
    const c = input[i];

    // 反斜杠：续行或转义
    if (c === '\\' && !ctx.cmdMode) {
      const next = input[i + 1];
      if (next === '\n') {
        i += 2;
        continue;
      }
      if (next === '\r' && input[i + 2] === '\n') {
        i += 3;
        continue;
      }
      if (next === undefined) {
        i++;
        continue;
      }
      cur += next;
      inWord = true;
      i += 2;
      continue;
    }

    if (c === "'" && !ctx.cmdMode) {
      const end = input.indexOf("'", i + 1);
      inWord = true;
      if (end === -1) {
        cur += input.slice(i + 1);
        ctx.warnings.push(tr(ctx.lang, '单引号未闭合，已按文本末尾处理', 'Unclosed single quote, using the end of the input'));
        i = n;
      } else {
        cur += input.slice(i + 1, end);
        i = end + 1;
      }
      continue;
    }

    if (c === '$' && input[i + 1] === "'" && !ctx.cmdMode) {
      const r = readAnsiC(input, i);
      cur += r.text;
      inWord = true;
      i = r.end;
      continue;
    }

    if (c === '"') {
      i++;
      inWord = true;
      while (i < n && input[i] !== '"') {
        const d = input[i];
        if (d === '\\' && i + 1 < n) {
          const e = input[i + 1];
          if (ctx.cmdMode) {
            if (e === '"' || e === '\\') {
              cur += e;
              i += 2;
              continue;
            }
            cur += d;
            i++;
            continue;
          }
          if (e === '"' || e === '\\' || e === '$' || e === '`') {
            cur += e;
            i += 2;
            continue;
          }
          if (e === '\n') {
            i += 2;
            continue;
          }
          cur += d;
          i++;
          continue;
        }
        if (d === '$' && !ctx.cmdMode) {
          const r = readVar(input, i, ctx);
          if (r) {
            cur += r.text;
            i = r.end;
            continue;
          }
        }
        cur += d;
        i++;
      }
      if (i >= n) ctx.warnings.push(tr(ctx.lang, '双引号未闭合，已按文本末尾处理', 'Unclosed double quote, using the end of the input'));
      else i++;
      continue;
    }

    if (c === '$' && !ctx.cmdMode) {
      const r = readVar(input, i, ctx);
      if (r) {
        cur += r.text;
        inWord = true;
        i = r.end;
        continue;
      }
    }

    if (c === ' ' || c === '\t' || c === '\u00a0') {
      push();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      push();
      tokens.push({ type: 'op', value: '\n' });
      i++;
      continue;
    }
    if (c === '#' && !inWord) {
      while (i < n && input[i] !== '\n') i++;
      continue;
    }
    if (c === '|') {
      push();
      if (input[i + 1] === '|') {
        tokens.push({ type: 'op', value: '||' });
        i += 2;
      } else {
        tokens.push({ type: 'op', value: '|' });
        i++;
      }
      continue;
    }
    if (c === '&') {
      push();
      if (input[i + 1] === '&') {
        tokens.push({ type: 'op', value: '&&' });
        i += 2;
      } else {
        tokens.push({ type: 'op', value: '&' });
        i++;
      }
      continue;
    }
    if (c === ';') {
      push();
      tokens.push({ type: 'op', value: ';' });
      i++;
      continue;
    }
    if (c === '>' || c === '<') {
      // 处理 2>&1、>/dev/null、>> 等重定向
      if (inWord && (cur === '1' || cur === '2')) {
        cur = '';
        inWord = false;
      }
      push();
      let j = i + 1;
      if (input[j] === '>') j++;
      if (input[j] === '&') {
        j++;
        while (j < n && /[0-9-]/.test(input[j])) j++;
        i = j;
        continue;
      }
      tokens.push({ type: 'op', value: '>' });
      i = j;
      continue;
    }
    cur += c;
    inWord = true;
    i++;
  }
  push();
  return tokens;
}

/** 预处理：去除提示符、统一换行、处理 cmd / PowerShell 续行 */
export function preprocess(raw: string): { text: string; cmdMode: boolean } {
  let text = raw.replace(/\r\n?/g, '\n');
  // 全角/不间断空格等
  text = text.replace(/[\u2028\u2029]/g, '\n');
  // AI 有时会给出 “智能引号”
  text = text.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // Markdown 代码块
  text = text.replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  // 行首的 $ 或 > 提示符
  text = text.replace(/^[ \t]*[$>][ \t]+(?=curl\b)/gm, '');
  let cmdMode = false;
  if (/\^\n/.test(text) || /\^"/.test(text)) {
    cmdMode = true;
    text = text.replace(/\^\n/g, ' ').replace(/\^(.)/g, '$1');
  }
  if (/`\n/.test(text)) {
    text = text.replace(/`\n/g, ' ');
  }
  return { text, cmdMode };
}
