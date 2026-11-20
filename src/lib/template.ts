/**
 * 模板变量：{{ name }}，以及内置动态变量 {{$uuid}} {{$timestamp}} 等
 */
import type { AppData, Folder, Variable } from './types';

export interface ResolvedVar {
  key: string;
  value: string;
  secret: boolean;
  /** 来源描述，例如 “环境：生产” / “文件夹：OpenAI” */
  source: string;
  sourceKind: 'base' | 'env' | 'folder' | 'dynamic';
  sourceId?: string;
}

export type VarMap = Map<string, ResolvedVar>;

export const TEMPLATE_RE = /\{\{\s*([$A-Za-z0-9_.\-\u4e00-\u9fa5]+)\s*\}\}/g;

export const DYNAMIC_VARS: { key: string; desc: string; gen: () => string }[] = [
  { key: '$uuid', desc: '随机 UUID', gen: () => uuidv4() },
  { key: '$timestamp', desc: 'Unix 时间戳（秒）', gen: () => String(Math.floor(Date.now() / 1000)) },
  { key: '$timestampMs', desc: 'Unix 时间戳（毫秒）', gen: () => String(Date.now()) },
  { key: '$isoTimestamp', desc: 'ISO 8601 时间', gen: () => new Date().toISOString() },
  { key: '$randomInt', desc: '0-1000 随机整数', gen: () => String(Math.floor(Math.random() * 1001)) },
  { key: '$date', desc: '今天日期 YYYY-MM-DD', gen: () => new Date().toISOString().slice(0, 10) },
];

function uuidv4(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function folderChain(data: AppData, folderId: string | null): Folder[] {
  const chain: Folder[] = [];
  const seen = new Set<string>();
  let cur = folderId ? data.folders.find((f) => f.id === folderId) : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? data.folders.find((f) => f.id === cur!.parentId) : undefined;
  }
  return chain; // 外层 -> 内层
}

/**
 * 计算某个位置可用的变量。
 * 优先级（后者覆盖前者）：全局环境 < 当前子环境 < 文件夹（外层 < 内层）
 */
export function resolveVariables(data: AppData, workspaceId: string, folderId: string | null): VarMap {
  const map: VarMap = new Map();
  const add = (vars: Variable[], source: string, sourceKind: ResolvedVar['sourceKind'], sourceId?: string) => {
    for (const v of vars) {
      if (!v.enabled || !v.key.trim()) continue;
      map.set(v.key.trim(), { key: v.key.trim(), value: v.value, secret: !!v.secret, source, sourceKind, sourceId });
    }
  };
  const envs = data.environments.filter((e) => e.workspaceId === workspaceId);
  const base = envs.find((e) => e.isBase);
  if (base) add(base.variables, '全局变量', 'base', base.id);
  const activeId = data.settings.activeEnvironment[workspaceId];
  const active = envs.find((e) => e.id === activeId && !e.isBase);
  if (active) add(active.variables, `环境：${active.name}`, 'env', active.id);
  for (const f of folderChain(data, folderId)) add(f.variables, `文件夹：${f.name}`, 'folder', f.id);
  return map;
}

export interface RenderResult {
  text: string;
  missing: string[];
}

export function renderTemplate(input: string, vars: VarMap, depth = 0): RenderResult {
  const missing: string[] = [];
  if (!input || !input.includes('{{')) return { text: input ?? '', missing };
  const text = input.replace(TEMPLATE_RE, (all, name: string) => {
    if (name.startsWith('$')) {
      const d = DYNAMIC_VARS.find((x) => x.key === name);
      return d ? d.gen() : all;
    }
    const v = vars.get(name);
    if (!v) {
      missing.push(name);
      return all;
    }
    if (depth < 5 && v.value.includes('{{')) {
      const inner = renderTemplate(v.value, vars, depth + 1);
      missing.push(...inner.missing);
      return inner.text;
    }
    return v.value;
  });
  return { text, missing };
}

export function render(input: string, vars: VarMap): string {
  return renderTemplate(input, vars).text;
}

export function findTemplateVars(input: string): string[] {
  const out: string[] = [];
  for (const m of (input ?? '').matchAll(TEMPLATE_RE)) out.push(m[1]);
  return out;
}
