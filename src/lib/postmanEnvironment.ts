import { newEnvironment } from './factory';
import type { Environment, Variable } from './types';
import { kv } from './util';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse an exported Postman environment. The caller chooses when to activate it. */
export function readPostmanEnvironment(doc: unknown, workspaceId: string): Environment | null {
  if (!isRecord(doc) || doc._postman_variable_scope !== 'environment') return null;
  if (!Array.isArray(doc.values) || typeof doc.name !== 'string' || !doc.name.trim()) return null;

  const variables: Variable[] = [];
  for (const entry of doc.values) {
    if (!isRecord(entry) || typeof entry.key !== 'string') return null;
    if (!entry.key.trim()) continue;
    const raw = entry.value ?? '';
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    variables.push({
      ...kv(entry.key, value, entry.enabled !== false && entry.disabled !== true),
      secret: entry.type === 'secret' || /key|token|secret|pass/i.test(entry.key),
    });
  }
  return newEnvironment(workspaceId, { name: doc.name.trim(), variables });
}
