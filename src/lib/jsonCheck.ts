import { TEMPLATE_RE } from './template';

function neutralizeTemplates(text: string): string {
  let result = '';
  let start = 0;
  let inString = false;
  for (const match of text.matchAll(TEMPLATE_RE)) {
    for (let i = start; i < match.index; i++) {
      if (inString && text[i] === '\\') i++;
      else if (text[i] === '"') inString = !inString;
    }
    result += text.slice(start, match.index) + (inString ? 'x' : '0');
    start = match.index + match[0].length;
  }
  return result + text.slice(start);
}

export function checkJsonBodySyntax(text: string): { ok: true } | { ok: false; message: string } {
  if (!text.trim()) return { ok: true };
  try {
    JSON.parse(neutralizeTemplates(text));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
