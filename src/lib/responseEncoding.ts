/** Use the HTTP charset for text previews, retaining UTF-8 for unlabeled responses and SSE. */
export function responseTextDecoder(contentType: string): TextDecoder {
  if (!/^text\/event-stream\s*(?:;|$)/i.test(contentType.trim())) {
    const parameters = /;\s*([^\s=;]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^;\s]+))/g;
    for (const [, name, quoted, token] of contentType.matchAll(parameters)) {
      if (name.toLowerCase() !== 'charset') continue;
      try {
        return new TextDecoder(quoted ?? token);
      } catch {
        break;
      }
    }
  }
  return new TextDecoder();
}
