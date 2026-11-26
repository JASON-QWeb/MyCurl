export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** The input has already passed JSON.parse. Only object keys and numbers can lose information. */
function hasLosslessTokens(raw: string): boolean {
  const scopes: Set<string>[] = [];
  const tokens = /("(?:[^"\\]|\\.)*")(\s*:)?|[{}]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const [token, quoted, colon] of raw.matchAll(tokens)) {
    if (token === '{') {
      scopes.push(new Set());
    } else if (token === '}') {
      scopes.pop();
    } else if (colon) {
      const keys = scopes[scopes.length - 1];
      const key: string = JSON.parse(quoted);
      if (keys.has(key)) return false;
      keys.add(key);
    } else if (!quoted) {
      const number = Number(token);
      if (JSON.stringify(number) !== token || (Number.isInteger(number) && !Number.isSafeInteger(number))) return false;
    }
  }
  return true;
}

export function inspectJson(raw: string): { value: JsonValue; lossless: boolean } | undefined {
  try {
    const value: JsonValue = JSON.parse(raw);
    return { value, lossless: hasLosslessTokens(raw) };
  } catch {
    return undefined;
  }
}

/** Undefined means the caller must use the original source, including its whitespace. */
export function parseLosslessJson(raw: string): JsonValue | undefined {
  const result = inspectJson(raw);
  return result?.lossless ? result.value : undefined;
}

export function toPythonLiteral(value: JsonValue, indent = 0): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value !== 'object') return JSON.stringify(value);

  const array = Array.isArray(value);
  const [open, close] = array ? ['[', ']'] : ['{', '}'];
  const nextIndent = indent + 4;
  const entries = array
    ? value.map(item => toPythonLiteral(item, nextIndent))
    : Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${toPythonLiteral(item, nextIndent)}`);
  if (!entries.length) return open + close;
  const padding = ' '.repeat(nextIndent);
  return `${open}\n${padding}${entries.join(',\n' + padding)}\n${' '.repeat(indent)}${close}`;
}
