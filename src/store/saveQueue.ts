import { saveAppData } from '../lib/storage';
import type { AppData } from '../lib/types';

type SetSaveState = (status: { saving: boolean; saveError: string | null }) => void;

let timer: ReturnType<typeof setTimeout> | null = null;
let lastWrite: Promise<string | null> | null = null;

export function flushSave(data: AppData, set: SetSaveState): Promise<boolean> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  set({ saving: true, saveError: null });
  const write = async () => {
    try {
      await saveAppData(data);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  // Queue snapshots in order so a slower autosave cannot overwrite a later manual save.
  const current = lastWrite ? lastWrite.then(write) : write();
  lastWrite = current;
  return current.then(error => {
    if (lastWrite === current) {
      lastWrite = null;
      set({ saving: false, saveError: error });
    }
    return error === null;
  });
}

export function scheduleSave(data: AppData, set: SetSaveState, immediate = false) {
  if (immediate) {
    void flushSave(data, set);
    return;
  }
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => { void flushSave(data, set); }, 320);
}
