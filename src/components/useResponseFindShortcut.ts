import { useEffect, type RefObject } from 'react';
import { EditorView } from '@codemirror/view';

function selectedText(pane: HTMLElement): string {
  const selection = window.getSelection();
  const viewer = selection?.anchorNode?.parentElement?.closest('.cm-editor, .sse-event-row, .sse-answer-box, .sse-reasoning');
  let text = viewer && pane.contains(viewer) && pane.contains(selection?.focusNode ?? null) ? selection?.toString() : '';
  if (!text) {
    const editor = document.activeElement?.closest<HTMLElement>('.cm-editor');
    const state = editor && pane.contains(editor) ? EditorView.findFromDOM(editor)?.state : null;
    const range = state?.selection.main;
    if (state && range && range.to - range.from <= 256) text = state.sliceDoc(range.from, range.to);
  }
  return text && text.length <= 256 && !/[\r\n]/.test(text) ? text : '';
}

export function useResponseFindShortcut(pane: RefObject<HTMLElement>, hasResponse: boolean, searchable: boolean,
  open: (selection?: string) => void) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!hasResponse || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
      if (!pane.current || document.querySelector('.modal-mask, [role="dialog"], dialog[open]')) return;
      const target = e.target instanceof Element && e.target !== document.body ? e.target : document.activeElement;
      const inside = pane.current.contains(target);
      if (!inside && target?.closest('input, textarea, select, [contenteditable], .cm-editor')) return;
      const header = inside && pane.current.querySelector<HTMLInputElement>('[data-response-header-filter]');
      if (!header && !searchable) return;
      e.preventDefault();
      e.stopPropagation();
      if (header) {
        header.focus();
        header.select();
      } else {
        open(target?.closest('.resp-search-bar') ? undefined : selectedText(pane.current));
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [pane, hasResponse, searchable, open]);
}
