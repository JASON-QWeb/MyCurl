import { newEnvironment } from './factory';
import type { Environment, Variable } from './types';
import { isCredentialKey, kv } from './util';

const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' };

export function parseDotEnv(text: string): Variable[] {
  const input = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const assignment = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][\w.-]*)[ \t]*=(.*)$/gm;
  const quotedValue = /[ \t]*(?:'([^']*)'|"((?:[^"\\]|\\[\s\S])*)")[ \t]*(?:#.*)?$/my;
  const values = new Map<string, string>();
  let entry: RegExpExecArray | null;
  while ((entry = assignment.exec(input))) {
    const [, key, raw] = entry;
    if (/^[ \t]*['"]/.test(raw)) {
      // A quoted value can continue past the end of the assignment's first line.
      quotedValue.lastIndex = assignment.lastIndex - raw.length;
      const quoted = quotedValue.exec(input);
      if (!quoted) continue;
      assignment.lastIndex = quotedValue.lastIndex;
      const value = quoted[1] ?? quoted[2].replace(/\\([nrt"\\])/g, (_, char: string) => escapes[char]);
      values.set(key, value);
    } else {
      values.set(key, raw.replace(/[ \t]#.*$/, '').trim());
    }
  }
  return Array.from(values, ([key, value]) => ({ ...kv(key, value), secret: isCredentialKey(key) }));
}

export function readDotEnvEnvironment(text: string, workspaceId: string, fileName?: string): Environment | null {
  const variables = parseDotEnv(text);
  if (!variables.length) return null;
  const baseName = fileName?.trim().split(/[\\/]/).pop() ?? '';
  const name = baseName.replace(/\.txt$/i, '').replace(/^\.env\./i, '').replace(/\.env$/i, '') || '.env';
  return newEnvironment(workspaceId, { name, variables });
}
