import React, { useMemo, useRef, useState } from 'react';
import { DYNAMIC_VARS, TEMPLATE_RE, type VarMap } from '../lib/template';
import { maskSecret } from '../lib/util';
import { looksLikeCurl } from '../lib/curlParser';

interface TemplateInputProps {
  value: string;
  onChange: (value: string) => void;
  vars: VarMap;
  placeholder?: string;
  bordered?: boolean;
  compact?: boolean;
  className?: string;
  onEnter?: () => void;
  onPasteCurl?: (text: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

interface Segment {
  text: string;
  kind: 'text' | 'ok' | 'secret' | 'missing';
}

function splitSegments(value: string, vars: VarMap): Segment[] {
  if (!value) return [];
  const segs: Segment[] = [];
  let last = 0;
  TEMPLATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEMPLATE_RE.exec(value))) {
    if (m.index > last) segs.push({ text: value.slice(last, m.index), kind: 'text' });
    const name = m[1];
    let kind: Segment['kind'] = 'ok';
    if (name.startsWith('$')) {
      kind = DYNAMIC_VARS.some((d) => d.key === name) ? 'ok' : 'missing';
    } else {
      const found = vars.get(name);
      if (!found) kind = 'missing';
      else if (found.secret) kind = 'secret';
    }
    segs.push({ text: m[0], kind });
    last = m.index + m[0].length;
  }
  if (last < value.length) segs.push({ text: value.slice(last), kind: 'text' });
  return segs;
}

export const TemplateInput: React.FC<TemplateInputProps> = ({
  value,
  onChange,
  vars,
  placeholder,
  bordered = false,
  compact = false,
  className = '',
  onEnter,
  onPasteCurl,
  inputRef,
}) => {
  const localRef = useRef<HTMLInputElement>(null);
  const elRef = inputRef ?? localRef;
  const backdropRef = useRef<HTMLDivElement>(null);
  const [ac, setAc] = useState<{ start: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const segments = useMemo(() => splitSegments(value, vars), [value, vars]);

  const suggestions = useMemo(() => {
    if (!ac) return [];
    const q = ac.query.toLowerCase();
    const list: { key: string; detail: string; secret?: boolean }[] = [];
    for (const v of vars.values()) {
      if (!q || v.key.toLowerCase().includes(q)) {
        list.push({
          key: v.key,
          detail: v.secret ? `${maskSecret(v.value)} (${v.source})` : `${v.value.slice(0, 28)} (${v.source})`,
          secret: v.secret,
        });
      }
    }
    for (const d of DYNAMIC_VARS) {
      if (!q || d.key.toLowerCase().includes(q)) {
        list.push({ key: d.key, detail: d.desc });
      }
    }
    return list.slice(0, 12);
  }, [ac, vars]);

  const syncScroll = () => {
    if (backdropRef.current && elRef.current) {
      backdropRef.current.scrollLeft = elRef.current.scrollLeft;
    }
  };

  const checkAutocomplete = (val: string, caret: number) => {
    const before = val.slice(0, caret);
    const open = before.lastIndexOf('{{');
    if (open >= 0 && !before.slice(open).includes('}}')) {
      const q = before.slice(open + 2);
      if (/^[\w$.\-\u4e00-\u9fa5]*$/.test(q)) {
        setAc({ start: open, query: q });
        setActiveIdx(0);
        return;
      }
    }
    setAc(null);
  };

  const insertSuggestion = (key: string) => {
    const el = elRef.current;
    if (!el || !ac) return;
    const caret = el.selectionStart ?? value.length;
    const after = value.slice(caret);
    const closeExtra = after.startsWith('}}') ? 2 : 0;
    const inserted = `{{${key}}}`;
    const next = value.slice(0, ac.start) + inserted + after.slice(closeExtra);
    onChange(next);
    setAc(null);
    const pos = ac.start + inserted.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      syncScroll();
    });
  };

  return (
    <div className={`tpl-wrap ${bordered ? 'tpl-bordered' : ''} ${compact ? 'tpl-compact' : ''} ${className}`}>
      <div className="tpl-input-shell">
        <div className="tpl-backdrop" ref={backdropRef} aria-hidden="true">
          <span className="tpl-backdrop-inner">
            {segments.map((s, i) =>
              s.kind === 'text' ? (
                <React.Fragment key={i}>{s.text}</React.Fragment>
              ) : (
                <span key={i} className={`tpl-var tpl-var-${s.kind}`}>
                  {s.text}
                </span>
              ),
            )}
          </span>
        </div>
        <input
          ref={elRef as React.RefObject<HTMLInputElement>}
          type="text"
          className="tpl-input"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onScroll={syncScroll}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v);
            checkAutocomplete(v, e.target.selectionStart ?? v.length);
            requestAnimationFrame(syncScroll);
          }}
          onPaste={(e) => {
            if (!onPasteCurl) return;
            const text = e.clipboardData.getData('text');
            if (looksLikeCurl(text)) {
              e.preventDefault();
              onPasteCurl(text);
            }
          }}
          onKeyDown={(e) => {
            if (ac && suggestions.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIdx((i) => (i + 1) % suggestions.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertSuggestion(suggestions[activeIdx].key);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setAc(null);
                return;
              }
            }
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          onBlur={() => setTimeout(() => setAc(null), 150)}
        />
      </div>

      {ac && suggestions.length > 0 && (
        <div className="tpl-popover">
          {suggestions.map((s, idx) => (
            <div
              key={s.key}
              className={`tpl-pop-item ${idx === activeIdx ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                insertSuggestion(s.key);
              }}
            >
              <span className="tpl-pop-key" style={s.secret ? { color: 'var(--var-secret-fg)' } : undefined}>
                {`{{${s.key}}}`}
              </span>
              <span className="tpl-pop-val">{s.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
