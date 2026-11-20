/**
 * Tauri v2 Rust 核心桥接层（在桌面端走 Rust IPC，在纯浏览器开发模式自动降级为 HTTP /api）
 */
import { Channel, invoke } from '@tauri-apps/api/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|Darwin/i.test(navigator.platform || navigator.userAgent);
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export function createTauriChannel<T>(onMessage: (msg: T) => void): Channel<T> {
  const ch = new Channel<T>();
  ch.onmessage = onMessage;
  return ch;
}

export async function readClipboardNative(): Promise<string | null> {
  if (isTauri()) {
    try {
      return await invoke<string>('read_clipboard');
    } catch {
      return null;
    }
  }
  try {
    if (navigator.clipboard?.readText) return await navigator.clipboard.readText();
  } catch {
    /* ignore */
  }
  return null;
}
