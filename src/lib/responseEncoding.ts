export function isBinaryContentType(ct: string): boolean {
  const lower = ct.toLowerCase();
  if (!lower) return false;
  if (/text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|event-stream|graphql|yaml|csv|svg\+xml/.test(lower)) return false;
  return /image\/|audio\/|video\/|application\/octet-stream|application\/pdf|application\/zip|application\/gzip|font\//.test(lower);
}

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
