/**
 * 迷你 jq 实现（常用子集），用于响应筛选。
 * 支持：. .a .a.b ."a" .[0] .[1:3] .[] ? | , // 括号、数组构造 [..]、对象构造 {a, b: .c}
 *      比较 == != < <= > >=、and or not、+ - * /、字面量
 *      函数：length keys values map select has type first last add tostring tonumber
 *            to_entries from_entries join split ascii_downcase ascii_upcase test contains
 *            sort sort_by group_by reverse unique min max flatten any all empty fromjson tojson
 *            startswith endswith ltrimstr rtrimstr .. (递归)
 * 也支持简单 JSONPath：$.a.b[0]、$.items[*].name
 */

import { tr } from './translate';
import type { Language } from './types';

class FilterError extends Error {
  constructor(zh: string, readonly en: string) { super(zh); }
}

type Node =
  | { k: 'identity' }
  | { k: 'recurse' }
  | { k: 'field'; target: Node; name: string; opt?: boolean }
  | { k: 'index'; target: Node; index: Node; opt?: boolean }
  | { k: 'slice'; target: Node; from: Node | null; to: Node | null }
  | { k: 'iterate'; target: Node; opt?: boolean }
  | { k: 'try'; body: Node }
  | { k: 'pipe'; left: Node; right: Node }
  | { k: 'comma'; left: Node; right: Node }
  | { k: 'alt'; left: Node; right: Node }
  | { k: 'binop'; op: string; left: Node; right: Node }
  | { k: 'and'; left: Node; right: Node }
  | { k: 'or'; left: Node; right: Node }
  | { k: 'literal'; value: unknown }
  | { k: 'array'; body: Node | null }
  | { k: 'object'; entries: { key: Node | string; value: Node | null }[] }
  | { k: 'call'; name: string; args: Node[] }
  | { k: 'neg'; body: Node };

type Tok = { t: string; v?: string | number };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          const e = src[j + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new Error('字符串未闭合');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['//', '==', '!=', '<=', '>=', '..'].includes(two)) {
      out.push({ t: two });
      i += 2;
      continue;
    }
    if ('.[](){}|,:?<>+-*/;'.includes(c)) {
      out.push({ t: c });
      i++;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!;
      out.push({ t: 'ident', v: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`无法识别的字符：${c}`);
  }
  return out;
}

class Parser {
  i = 0;
  constructor(private toks: Tok[]) {}
  peek(o = 0) {
    return this.toks[this.i + o];
  }
  eat(t?: string): Tok {
    const tok = this.toks[this.i];
    if (!tok || (t && tok.t !== t)) throw new Error(`语法错误：期望 ${t ?? '表达式'}，实际 ${tok ? tok.v ?? tok.t : '结尾'}`);
    this.i++;
    return tok;
  }
  is(t: string, v?: string) {
    const tok = this.toks[this.i];
    return !!tok && tok.t === t && (v === undefined || tok.v === v);
  }
  parse(): Node {
    const n = this.pipe();
    if (this.i < this.toks.length) throw new Error(`语法错误：多余的 ${this.peek().v ?? this.peek().t}`);
    return n;
  }
  pipe(): Node {
    let left = this.comma();
    while (this.is('|')) {
      this.eat();
      left = { k: 'pipe', left, right: this.comma() };
    }
    return left;
  }
  comma(): Node {
    let left = this.alt();
    while (this.is(',')) {
      this.eat();
      left = { k: 'comma', left, right: this.alt() };
    }
    return left;
  }
  alt(): Node {
    const left = this.or();
    if (this.is('//')) {
      this.eat();
      return { k: 'alt', left, right: this.alt() };
    }
    return left;
  }
  or(): Node {
    let left = this.and();
    while (this.is('ident', 'or')) {
      this.eat();
      left = { k: 'or', left, right: this.and() };
    }
    return left;
  }
  and(): Node {
    let left = this.compare();
    while (this.is('ident', 'and')) {
      this.eat();
      left = { k: 'and', left, right: this.compare() };
    }
    return left;
  }
  compare(): Node {
    const left = this.additive();
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.is(op)) {
        this.eat();
        return { k: 'binop', op, left, right: this.additive() };
      }
    }
    return left;
  }
  additive(): Node {
    let left = this.mult();
    while (this.is('+') || this.is('-')) {
      const op = this.eat().t;
      left = { k: 'binop', op, left, right: this.mult() };
    }
    return left;
  }
  mult(): Node {
    let left = this.postfix();
    while (this.is('*') || this.is('/')) {
      const op = this.eat().t;
      left = { k: 'binop', op, left, right: this.postfix() };
    }
    return left;
  }
  postfix(): Node {
    let node = this.primary();
    for (;;) {
      if (this.is('.') && this.peek(1) && (this.peek(1).t === 'ident' || this.peek(1).t === 'str')) {
        this.eat();
        const name = String(this.eat().v);
        node = { k: 'field', target: node, name };
      } else if (this.is('.') && this.peek(1)?.t === '[') {
        this.eat();
      } else if (this.is('[')) {
        node = this.bracket(node);
      } else if (this.is('?')) {
        this.eat();
        node = { k: 'try', body: node };
      } else break;
    }
    return node;
  }
  bracket(target: Node): Node {
    this.eat('[');
    if (this.is(']')) {
      this.eat();
      return { k: 'iterate', target };
    }
    if (this.is(':')) {
      this.eat();
      const to = this.pipe();
      this.eat(']');
      return { k: 'slice', target, from: null, to };
    }
    const idx = this.pipe();
    if (this.is(':')) {
      this.eat();
      const to = this.is(']') ? null : this.pipe();
      this.eat(']');
      return { k: 'slice', target, from: idx, to };
    }
    this.eat(']');
    return { k: 'index', target, index: idx };
  }
  primary(): Node {
    const tok = this.peek();
    if (!tok) throw new Error('表达式不完整');
    if (tok.t === '..') {
      this.eat();
      return { k: 'recurse' };
    }
    if (tok.t === '.') {
      this.eat();
      const nx = this.peek();
      if (nx && (nx.t === 'ident' || nx.t === 'str')) {
        this.eat();
        return { k: 'field', target: { k: 'identity' }, name: String(nx.v) };
      }
      if (nx && nx.t === '[') return this.bracket({ k: 'identity' });
      return { k: 'identity' };
    }
    if (tok.t === 'num') {
      this.eat();
      return { k: 'literal', value: tok.v };
    }
    if (tok.t === 'str') {
      this.eat();
      return { k: 'literal', value: tok.v };
    }
    if (tok.t === '-') {
      this.eat();
      return { k: 'neg', body: this.postfix() };
    }
    if (tok.t === '(') {
      this.eat();
      const n = this.pipe();
      this.eat(')');
      return n;
    }
    if (tok.t === '[') {
      this.eat();
      if (this.is(']')) {
        this.eat();
        return { k: 'array', body: null };
      }
      const body = this.pipe();
      this.eat(']');
      return { k: 'array', body };
    }
    if (tok.t === '{') {
      this.eat();
      const entries: { key: Node | string; value: Node | null }[] = [];
      while (!this.is('}')) {
        let key: Node | string;
        const kt = this.peek();
        if (kt.t === 'ident' || kt.t === 'str') {
          this.eat();
          key = String(kt.v);
        } else if (kt.t === '(') {
          this.eat();
          key = this.pipe();
          this.eat(')');
        } else throw new Error('对象构造语法错误');
        let value: Node | null = null;
        if (this.is(':')) {
          this.eat();
          value = this.alt();
        }
        entries.push({ key, value });
        if (this.is(',')) this.eat();
        else break;
      }
      this.eat('}');
      return { k: 'object', entries };
    }
    if (tok.t === 'ident') {
      this.eat();
      const name = String(tok.v);
      if (name === 'null') return { k: 'literal', value: null };
      if (name === 'true') return { k: 'literal', value: true };
      if (name === 'false') return { k: 'literal', value: false };
      const args: Node[] = [];
      if (this.is('(')) {
        this.eat();
        args.push(this.pipe());
        while (this.is(';')) {
          this.eat();
          args.push(this.pipe());
        }
        this.eat(')');
      }
      return { k: 'call', name, args };
    }
    throw new Error(`语法错误：意外的 ${tok.v ?? tok.t}`);
  }
}

function typeOf(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function truthy(v: unknown) {
  return v !== null && v !== undefined && v !== false;
}

function cmp(a: unknown, b: unknown): number {
  const order = ['null', 'boolean', 'number', 'string', 'array', 'object'];
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) return order.indexOf(ta) - order.indexOf(tb);
  if (ta === 'number') return (a as number) - (b as number);
  if (ta === 'string') return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  if (ta === 'boolean') return Number(a) - Number(b);
  return JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0;
}

/** jq orders strings by Unicode code point, arrays by element, and objects by their keys first. */
function compareGroupKeys(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (typeof a === 'string' && typeof b === 'string') {
    let i = 0;
    while (i < a.length && i < b.length) {
      const code = a.codePointAt(i)!;
      const diff = code - b.codePointAt(i)!;
      if (diff !== 0) return diff;
      i += code > 0xffff ? 2 : 1;
    }
    return a.length - b.length;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const diff = compareGroupKeys(a[i], b[i]);
      if (diff !== 0) return diff;
    }
    return a.length - b.length;
  }
  if (typeOf(a) === 'object' && typeOf(b) === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    const keys = Object.keys(left).sort(compareGroupKeys);
    const keyDiff = compareGroupKeys(keys, Object.keys(right).sort(compareGroupKeys));
    if (keyDiff !== 0) return keyDiff;
    for (const key of keys) {
      const diff = compareGroupKeys(left[key], right[key]);
      if (diff !== 0) return diff;
    }
    return 0;
  }
  return cmp(a, b);
}

function groupBy(input: unknown, keyFilter: Node): unknown[][] {
  if (!Array.isArray(input)) throw new FilterError('group_by 需要数组', 'group_by requires an array');
  const rows = input.map(value => ({ value, key: evalNode(keyFilter, value) }));
  rows.sort((a, b) => compareGroupKeys(a.key, b.key));
  const groups: unknown[][] = [];
  let previous: unknown[] | undefined;
  for (const { key, value } of rows) {
    if (!previous || compareGroupKeys(previous, key) !== 0) groups.push([]);
    groups[groups.length - 1].push(value);
    previous = key;
  }
  return groups;
}

function deepEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function* recurse(v: unknown): Generator<unknown> {
  yield v;
  if (Array.isArray(v)) for (const x of v) yield* recurse(x);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) yield* recurse(x);
}

function evalNode(n: Node, input: unknown): unknown[] {
  switch (n.k) {
    case 'identity':
      return [input];
    case 'recurse':
      return [...recurse(input)];
    case 'literal':
      return [n.value];
    case 'field':
      return evalNode(n.target, input).map((v) => {
        if (v === null || v === undefined) return null;
        if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`无法在 ${typeOf(v)} 上取字段 "${n.name}"`);
        const r = (v as Record<string, unknown>)[n.name];
        return r === undefined ? null : r;
      });
    case 'index': {
      const out: unknown[] = [];
      for (const v of evalNode(n.target, input)) {
        for (const idx of evalNode(n.index, input)) {
          if (v === null || v === undefined) out.push(null);
          else if (typeof idx === 'number') {
            if (!Array.isArray(v)) throw new Error(`无法用数字索引 ${typeOf(v)}`);
            const i = idx < 0 ? v.length + idx : Math.floor(idx);
            out.push(v[i] === undefined ? null : v[i]);
          } else if (typeof idx === 'string') {
            if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`无法在 ${typeOf(v)} 上取字段 "${idx}"`);
            const r = (v as Record<string, unknown>)[idx];
            out.push(r === undefined ? null : r);
          } else throw new Error('索引必须是数字或字符串');
        }
      }
      return out;
    }
    case 'slice': {
      const out: unknown[] = [];
      for (const v of evalNode(n.target, input)) {
        if (v === null) {
          out.push(null);
          continue;
        }
        if (!Array.isArray(v) && typeof v !== 'string') throw new Error(`无法切片 ${typeOf(v)}`);
        const from = n.from ? (evalNode(n.from, input)[0] as number) : undefined;
        const to = n.to ? (evalNode(n.to, input)[0] as number) : undefined;
        out.push(v.slice(from, to));
      }
      return out;
    }
    case 'iterate': {
      const out: unknown[] = [];
      for (const v of evalNode(n.target, input)) {
        if (Array.isArray(v)) out.push(...v);
        else if (v && typeof v === 'object') out.push(...Object.values(v));
        else throw new Error(`无法遍历 ${typeOf(v)}`);
      }
      return out;
    }
    case 'try':
      try {
        return evalNode(n.body, input);
      } catch {
        return [];
      }
    case 'pipe': {
      const out: unknown[] = [];
      for (const v of evalNode(n.left, input)) out.push(...evalNode(n.right, v));
      return out;
    }
    case 'comma':
      return [...evalNode(n.left, input), ...evalNode(n.right, input)];
    case 'alt': {
      let left: unknown[] = [];
      try {
        left = evalNode(n.left, input).filter(truthy);
      } catch {
        left = [];
      }
      return left.length ? left : evalNode(n.right, input);
    }
    case 'and': {
      const out: unknown[] = [];
      for (const l of evalNode(n.left, input)) {
        if (!truthy(l)) out.push(false);
        else for (const r of evalNode(n.right, input)) out.push(truthy(r));
      }
      return out;
    }
    case 'or': {
      const out: unknown[] = [];
      for (const l of evalNode(n.left, input)) {
        if (truthy(l)) out.push(true);
        else for (const r of evalNode(n.right, input)) out.push(truthy(r));
      }
      return out;
    }
    case 'neg':
      return evalNode(n.body, input).map((v) => -(v as number));
    case 'binop': {
      const out: unknown[] = [];
      for (const r of evalNode(n.right, input))
        for (const l of evalNode(n.left, input)) {
          switch (n.op) {
            case '==':
              out.push(deepEqual(l, r));
              break;
            case '!=':
              out.push(!deepEqual(l, r));
              break;
            case '<':
              out.push(cmp(l, r) < 0);
              break;
            case '<=':
              out.push(cmp(l, r) <= 0);
              break;
            case '>':
              out.push(cmp(l, r) > 0);
              break;
            case '>=':
              out.push(cmp(l, r) >= 0);
              break;
            case '+':
              if (l === null) out.push(r);
              else if (r === null) out.push(l);
              else if (Array.isArray(l) && Array.isArray(r)) out.push([...l, ...r]);
              else if (typeof l === 'object' && typeof r === 'object') out.push({ ...(l as object), ...(r as object) });
              else out.push((l as number) + (r as number));
              break;
            case '-':
              if (Array.isArray(l) && Array.isArray(r)) out.push(l.filter((x) => !r.some((y) => deepEqual(x, y))));
              else out.push((l as number) - (r as number));
              break;
            case '*':
              out.push((l as number) * (r as number));
              break;
            case '/':
              if (typeof l === 'string' && typeof r === 'string') out.push(l.split(r));
              else out.push((l as number) / (r as number));
              break;
          }
        }
      return out;
    }
    case 'array':
      return [n.body ? evalNode(n.body, input) : []];
    case 'object': {
      let results: Record<string, unknown>[] = [{}];
      for (const e of n.entries) {
        const keys = typeof e.key === 'string' ? [e.key] : evalNode(e.key, input).map(String);
        const values = e.value ? evalNode(e.value, input) : keys.map((k) => (input as Record<string, unknown>)?.[k] ?? null);
        const next: Record<string, unknown>[] = [];
        for (const r of results)
          for (const k of keys)
            for (const v of e.value ? values : [(input as Record<string, unknown>)?.[k] ?? null]) next.push({ ...r, [k]: v });
        results = next;
      }
      return results;
    }
    case 'call':
      return callFn(n.name, n.args, input);
  }
}

function callFn(name: string, args: Node[], input: unknown): unknown[] {
  const arg = (i: number, v: unknown = input) => evalNode(args[i], v);
  switch (name) {
    case 'empty':
      return [];
    case 'not':
      return [!truthy(input)];
    case 'length':
      if (input === null) return [0];
      if (typeof input === 'string' || Array.isArray(input)) return [input.length];
      if (typeof input === 'object') return [Object.keys(input as object).length];
      if (typeof input === 'number') return [Math.abs(input)];
      throw new Error('length 不支持该类型');
    case 'keys':
      if (Array.isArray(input)) return [input.map((_, i) => i)];
      return [Object.keys(input as object).sort()];
    case 'keys_unsorted':
      return [Object.keys(input as object)];
    case 'values':
      return input === null ? [] : [input];
    case 'type':
      return [typeOf(input)];
    case 'map': {
      if (!Array.isArray(input)) throw new Error('map 需要数组');
      return [input.flatMap((x) => arg(0, x))];
    }
    case 'select':
      return arg(0).some(truthy) ? [input] : [];
    case 'has': {
      const k = arg(0)[0];
      if (Array.isArray(input)) return [typeof k === 'number' && k < input.length];
      return [input !== null && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, k as string)];
    }
    case 'first':
      return args.length ? arg(0).slice(0, 1) : [(input as unknown[])[0] ?? null];
    case 'last':
      return args.length ? arg(0).slice(-1) : [(input as unknown[])[(input as unknown[]).length - 1] ?? null];
    case 'add': {
      const arr = input as unknown[];
      if (!arr.length) return [null];
      return [arr.reduce((a: unknown, b: unknown) => {
        if (a === null) return b;
        if (typeof a === 'string' || typeof a === 'number') return (a as number) + (b as number);
        if (Array.isArray(a)) return [...a, ...(b as unknown[])];
        return { ...(a as object), ...(b as object) };
      })];
    }
    case 'tostring':
      return [typeof input === 'string' ? input : JSON.stringify(input)];
    case 'tonumber':
      return [typeof input === 'number' ? input : Number(input)];
    case 'tojson':
      return [JSON.stringify(input)];
    case 'fromjson':
      return [JSON.parse(input as string)];
    case 'to_entries':
      return [Object.entries(input as object).map(([key, value]) => ({ key, value }))];
    case 'from_entries':
      return [Object.fromEntries((input as { key?: string; name?: string; k?: string; value?: unknown; v?: unknown }[]).map((e) => [e.key ?? e.name ?? e.k, e.value ?? e.v]))];
    case 'join': {
      const sep = arg(0)[0] as string;
      return [(input as unknown[]).map((x) => (x === null ? '' : typeof x === 'string' ? x : JSON.stringify(x))).join(sep)];
    }
    case 'split':
      return [(input as string).split(arg(0)[0] as string)];
    case 'ascii_downcase':
      return [(input as string).toLowerCase()];
    case 'ascii_upcase':
      return [(input as string).toUpperCase()];
    case 'ltrimstr': {
      const s = arg(0)[0] as string;
      return [typeof input === 'string' && input.startsWith(s) ? input.slice(s.length) : input];
    }
    case 'rtrimstr': {
      const s = arg(0)[0] as string;
      return [typeof input === 'string' && input.endsWith(s) ? input.slice(0, -s.length) : input];
    }
    case 'startswith':
      return [(input as string).startsWith(arg(0)[0] as string)];
    case 'endswith':
      return [(input as string).endsWith(arg(0)[0] as string)];
    case 'test': {
      const re = new RegExp(arg(0)[0] as string, args[1] ? String(arg(1)[0]).replace(/[^gimsuy]/g, '') : '');
      return [re.test(input as string)];
    }
    case 'contains': {
      const b = arg(0)[0];
      const contains = (a: unknown, b: unknown): boolean => {
        if (typeof a === 'string' && typeof b === 'string') return a.includes(b);
        if (Array.isArray(a) && Array.isArray(b)) return b.every((y) => a.some((x) => contains(x, y)));
        if (a && b && typeof a === 'object' && typeof b === 'object')
          return Object.entries(b).every(([k, v]) => contains((a as Record<string, unknown>)[k], v));
        return deepEqual(a, b);
      };
      return [contains(input, b)];
    }
    case 'sort':
      return [[...(input as unknown[])].sort(cmp)];
    case 'sort_by':
      return [[...(input as unknown[])].sort((a, b) => cmp(arg(0, a)[0], arg(0, b)[0]))];
    case 'group_by':
      if (args.length !== 1) throw new FilterError('group_by 需要一个筛选表达式', 'group_by requires one filter expression');
      return [groupBy(input, args[0])];
    case 'reverse':
      return [typeof input === 'string' ? [...input].reverse().join('') : [...(input as unknown[])].reverse()];
    case 'unique': {
      const seen = new Set<string>();
      return [[...(input as unknown[])].sort(cmp).filter((x) => {
        const k = JSON.stringify(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })];
    }
    case 'min':
      return [[...(input as unknown[])].sort(cmp)[0] ?? null];
    case 'max':
      return [[...(input as unknown[])].sort(cmp).pop() ?? null];
    case 'flatten':
      return [(input as unknown[]).flat(args.length ? (arg(0)[0] as number) : Infinity)];
    case 'any':
      return [args.length ? (input as unknown[]).some((x) => truthy(arg(0, x)[0])) : (input as unknown[]).some(truthy)];
    case 'all':
      return [args.length ? (input as unknown[]).every((x) => truthy(arg(0, x)[0])) : (input as unknown[]).every(truthy)];
    case 'range': {
      const a = arg(0)[0] as number;
      const out: number[] = [];
      if (args.length === 1) for (let i = 0; i < a; i++) out.push(i);
      else for (let i = a; i < (arg(1)[0] as number); i++) out.push(i);
      return out;
    }
    case 'floor':
      return [Math.floor(input as number)];
    case 'sqrt':
      return [Math.sqrt(input as number)];
    case 'ascii':
      return [String.fromCharCode(input as number)];
    case 'paths': {
      const out: unknown[] = [];
      const walk = (v: unknown, p: (string | number)[]) => {
        if (p.length) out.push(p);
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i]));
        else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, [...p, k]));
      };
      walk(input, []);
      return out;
    }
    case 'error':
      throw new Error(args.length ? String(arg(0)[0]) : String(input));
    case 'recurse':
      return [...recurse(input)];
    case 'env':
    case '$ENV':
      return [{}];
    case 'input':
    case 'debug':
      return [input];
    default:
      throw new Error(`不支持的函数：${name}`);
  }
}

/** JSONPath -> jq 的简单转换 */
function jsonPathToJq(expr: string): string {
  let e = expr.trim();
  if (!e.startsWith('$')) return e;
  e = e.slice(1);
  // Match strings as whole tokens so wildcards inside quoted keys and values stay literal.
  const tokens = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\[\*\]|\.\*|\[\?\(\s*@((?:\.[\w$]+)+)(?:\s*(==|!=)\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?))?\s*\)\]/g;
  e = e.replace(tokens, (token, field, op, literal) => {
    if (field) return `[] | select(${field}${op ? ` ${op} ${literal}` : ''})`;
    return token === '[*]' || token === '.*' ? '[]' : token;
  });
  if (e.startsWith('..')) e = '..|' + e.slice(1);
  if (!e.startsWith('.') && !e.startsWith('[')) e = '.' + e;
  if (e.startsWith('[')) e = '.' + e;
  return e || '.';
}

export function compileFilter(expr: string): Node {
  const src = jsonPathToJq(expr);
  return new Parser(lex(src)).parse();
}

export function runFilter(expr: string, input: unknown): unknown[] {
  const node = compileFilter(expr);
  return evalNode(node, input);
}

/** 以 jq -r 的方式输出结果 */
export function formatFilterOutput(values: unknown[]): string {
  return values
    .map((v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2)))
    .join('\n');
}

export function applyFilterToText(expr: string, text: string, lang?: Language): { ok: true; output: string } | { ok: false; error: string } {
  try {
    const data = JSON.parse(text);
    return { ok: true, output: formatFilterOutput(runFilter(expr, data)) };
  } catch (e) {
    return { ok: false, error: e instanceof FilterError ? tr(lang, e.message, e.en) : (e as Error).message };
  }
}
