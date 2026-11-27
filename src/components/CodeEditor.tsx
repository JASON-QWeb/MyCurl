import { responseHighlights, setResponseHighlights } from './responseHighlights';
import type { MatchRange } from '../lib/responseSearch';
import React, { useEffect, useRef } from 'react';
import { EditorState, RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, bracketMatching, foldGutter, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { tags } from '@lezer/highlight';
import { DYNAMIC_VARS, TEMPLATE_RE, type VarMap } from '../lib/template';
import { maskSecret } from '../lib/util';

export type CodeLang = 'json' | 'xml' | 'html' | 'javascript' | 'text';

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: CodeLang;
  readOnly?: boolean;
  dark?: boolean;
  fontSize?: number;
  placeholder?: string;
  vars?: VarMap;
  lineWrap?: boolean;
  searchMatches?: MatchRange[];
  activeMatchIndex?: number;
  onCtrlEnter?: () => void;
}

const darkHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#93c5fd' },
  { tag: tags.string, color: '#86efac' },
  { tag: tags.number, color: '#fcd34d' },
  { tag: [tags.bool, tags.null], color: '#f472b6' },
  { tag: tags.keyword, color: '#c4b5fd' },
  { tag: tags.comment, color: '#64748b', fontStyle: 'italic' },
  { tag: tags.tagName, color: '#f87171' },
  { tag: tags.attributeName, color: '#fbbf24' },
  { tag: tags.punctuation, color: '#94a3b8' },
]);

const lightHighlight = HighlightStyle.define([
  { tag: tags.propertyName, color: '#1d4ed8' },
  { tag: tags.string, color: '#047857' },
  { tag: tags.number, color: '#b45309' },
  { tag: [tags.bool, tags.null], color: '#be185d' },
  { tag: tags.keyword, color: '#6d28d9' },
  { tag: tags.comment, color: '#94a3b8', fontStyle: 'italic' },
  { tag: tags.tagName, color: '#dc2626' },
  { tag: tags.attributeName, color: '#b45309' },
  { tag: tags.punctuation, color: '#64748b' },
]);

function makeTheme(dark: boolean, fontSize: number) {
  return EditorView.theme(
    {
      '&': {
        backgroundColor: 'var(--bg-input)',
        color: 'var(--text)',
        fontSize: `${fontSize}px`,
        height: '100%',
      },
      '.cm-content': {
        padding: '10px 0',
        caretColor: 'var(--accent)',
        fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
      },
      '.cm-line': {
        padding: '0 12px',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--bg-input)',
        color: 'var(--text-muted)',
        borderRight: '1px solid var(--border)',
        fontSize: '11px',
      },
      '.cm-activeLine': {
        backgroundColor: dark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--text-dim)',
      },
      '.cm-selectionBackground, ::selection': {
        backgroundColor: dark ? 'rgba(124,106,247,0.32) !important' : 'rgba(99,83,234,0.2) !important',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--accent)',
      },
      '.cm-tpl-ok': {
        backgroundColor: 'var(--var-bg)',
        color: 'var(--var-fg)',
        borderRadius: '3px',
        padding: '0 2px',
      },
      '.cm-tpl-secret': {
        backgroundColor: 'var(--var-secret-bg)',
        color: 'var(--var-secret-fg)',
        borderRadius: '3px',
        padding: '0 2px',
      },
      '.cm-tpl-missing': {
        backgroundColor: 'var(--var-missing-bg)',
        color: 'var(--var-missing-fg)',
        borderRadius: '3px',
        padding: '0 2px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete': {
        backgroundColor: 'var(--bg-elev)',
        border: '1px solid var(--border-strong)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow)',
        overflow: 'hidden',
      },
      '.cm-tooltip-autocomplete ul li': {
        padding: '4px 10px',
      },
      '.cm-tooltip-autocomplete ul li[aria-selected]': {
        backgroundColor: 'var(--bg-active)',
        color: 'var(--text)',
      },
    },
    { dark },
  );
}

function langExtension(lang: CodeLang): Extension {
  switch (lang) {
    case 'json':
      return json();
    case 'xml':
      return xml();
    case 'html':
      return html();
    case 'javascript':
      return javascript();
    default:
      return [];
  }
}

const varsChangedEffect = StateEffect.define<void>();

function makeTemplateHighlighter(varsRef: React.MutableRefObject<VarMap | undefined>) {
  const build = (view: EditorView) => {
    const builder = new RangeSetBuilder<Decoration>();
    const vars = varsRef.current;
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      TEMPLATE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TEMPLATE_RE.exec(text))) {
        const name = m[1];
        let cls = 'cm-tpl-ok';
        if (name.startsWith('$')) {
          cls = DYNAMIC_VARS.some((d) => d.key === name) ? 'cm-tpl-ok' : 'cm-tpl-missing';
        } else if (vars) {
          const found = vars.get(name);
          if (!found) cls = 'cm-tpl-missing';
          else if (found.secret) cls = 'cm-tpl-secret';
        }
        builder.add(from + m.index, from + m.index + m[0].length, Decoration.mark({ class: cls }));
      }
    }
    return builder.finish();
  };

  return ViewPlugin.fromClass(
    class {
      decorations;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.transactions.some(tr => tr.effects.some(effect => effect.is(varsChangedEffect)))) {
          this.decorations = build(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  language = 'json',
  readOnly = false,
  dark = true,
  fontSize = 13,
  placeholder = '',
  vars,
  lineWrap = true,
  onCtrlEnter, searchMatches, activeMatchIndex = -1,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCtrlEnterRef = useRef(onCtrlEnter);
  const varsRef = useRef(vars);
  onChangeRef.current = onChange;
  onCtrlEnterRef.current = onCtrlEnter;

  useEffect(() => {
    if (!hostRef.current) return;

    const varCompletion = (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\{\{[\w$.\-\u4e00-\u9fa5]*/);
      if (!m) return null;
      const items: { label: string; apply: string; detail: string; type: string }[] = [];
      if (varsRef.current) {
        for (const v of varsRef.current.values()) {
          items.push({
            label: v.key,
            apply: `{{${v.key}}}`,
            detail: v.secret ? `${maskSecret(v.value)} · ${v.source}` : `${v.value.slice(0, 32)} · ${v.source}`,
            type: v.secret ? 'constant' : 'variable',
          });
        }
      }
      for (const d of DYNAMIC_VARS) {
        items.push({ label: d.key, apply: `{{${d.key}}}`, detail: d.desc, type: 'function' });
      }
      return { from: m.from, options: items, validFor: /^[\w$.\-\u4e00-\u9fa5{}]*$/ };
    };

    const extensions: Extension[] = [
      lineNumbers(),
      foldGutter(),
      bracketMatching(),
      highlightSelectionMatches(),
      langExtension(language),
      makeTheme(dark, fontSize),
      syntaxHighlighting(dark ? darkHighlight : lightHighlight),
      makeTemplateHighlighter(varsRef),
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            if (onCtrlEnterRef.current) {
              onCtrlEnterRef.current();
              return true;
            }
            return false;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        ...(readOnly ? [] : searchKeymap),
        indentWithTab,
      ]),
    ];

    if (lineWrap) extensions.push(EditorView.lineWrapping);
    if (placeholder) extensions.push(cmPlaceholder(placeholder));
    if (readOnly) {
      extensions.push(responseHighlights, EditorState.readOnly.of(true), EditorView.editable.of(false));
    } else {
      extensions.push(
        history(),
        indentOnInput(),
        highlightActiveLine(),
        autocompletion({ override: [varCompletion] }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && onChangeRef.current) {
            onChangeRef.current(u.state.doc.toString());
          }
        }),
      );
    }

    const state = EditorState.create({ doc: value ?? '', extensions });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [language, readOnly, dark, fontSize, lineWrap, placeholder]);

  useEffect(() => {
    if (varsRef.current === vars) return;
    varsRef.current = vars;
    viewRef.current?.dispatch({ effects: varsChangedEffect.of() });
  }, [vars]);

  // 同步外部 value 变化
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur !== (value ?? '')) {
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: value ?? '' },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !readOnly) return;
    const effects: StateEffect<unknown>[] = [setResponseHighlights.of({ matches: searchMatches ?? [], active: activeMatchIndex })];
    const match = searchMatches?.[activeMatchIndex];
    if (match && match.from <= view.state.doc.length && typeof Range.prototype.getClientRects === 'function') {
      effects.push(EditorView.scrollIntoView(match.from, { y: 'center' }));
    }
    view.dispatch({ effects });
  }, [searchMatches, activeMatchIndex, value, language, readOnly, dark, fontSize, lineWrap, placeholder]);

  return <div ref={hostRef} className="editor-fill" />;
};
