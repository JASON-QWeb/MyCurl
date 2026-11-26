import { exportAsCurl, exportResolvedUrl } from './curlExport';
import { tr } from './translate';
import type { AppData, CurlCopySecretMode, HttpRequest } from './types';
import { copyText } from './util';

export function requestClipboard(data: AppData, toast: (message: string, kind: 'success' | 'error') => void) {
  const lang = data.settings.language;
  const mode = data.settings.curlCopySecretMode === 'resolve' ? 'resolve' : 'mask';
  const copy = async (getText: () => string, message: string) => {
    try {
      await copyText(getText());
      toast(message, 'success');
    } catch {
      toast(tr(lang, '无法复制到剪贴板', 'Could not copy to clipboard'), 'error');
    }
  };
  return {
    mode,
    copyCurl: (req: HttpRequest, secretMode: CurlCopySecretMode = mode) => copy(
      () => exportAsCurl(data, req, { secretMode, includeJq: true }),
      secretMode === 'resolve'
        ? tr(lang, '已复制 cURL 命令（含明文密钥）', 'Copied cURL (raw secrets included)')
        : tr(lang, '已复制 cURL 命令（密钥已脱敏）', 'Copied cURL (secrets masked)'),
    ),
    copyUrl: (req: HttpRequest) => copy(
      () => exportResolvedUrl(data, req, mode), tr(lang, '已复制解析后的 URL', 'Copied resolved URL'),
    ),
  } as const;
}
