import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DYNAMIC_VARS, TEMPLATE_RE, type ResolvedVar, type VarMap } from '../lib/template';
import { maskSecret } from '../lib/util';
import { looksLikeCurl } from '../lib/curlParser';
import { IconCheck, IconChevronDown, IconKey, IconLayers } from './Icons';

export interface VarPickerAction {
  label: string;
  onClick: () => void;
}

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
  /** 在输入框右侧展示下拉选择按钮，支持一键从当前作用域密钥/变量中选择并替换值 */
  showVarPicker?: boolean;
  /** 下拉按钮文案，默认“选择” */
  varPickerLabel?: string;
  /** 下拉面板底部的快捷管理入口 */
  varPickerActions?: VarPickerAction[];
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

const SOURCE_RANK: Record<ResolvedVar['sourceKind'], number> = {
  folder: 0,
  env: 1,
  base: 2,
  dynamic: 3,
};

function formatVarDetail(v: ResolvedVar): string {
  const shown = v.secret
    ? maskSecret(v.value)
    : v.value.length > 28
      ? v.value.slice(0, 28) + '…'
      : v.value || '(空)';
  return `${shown} · ${v.source}`;
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
  showVarPicker = false,
  varPickerLabel = '选择',
  varPickerActions,
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLInputElement>(null);
  const elRef = inputRef ?? localRef;
  const backdropRef = useRef<HTMLDivElement>(null);
  const [ac, setAc] = useState<{ start: number; query: string } | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIdx, setPickerIdx] = useState(0);

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

  const { secretVars, otherVars, flatPickerVars } = useMemo(() => {
    if (!showVarPicker) return { secretVars: [] as ResolvedVar[], otherVars: [] as ResolvedVar[], flatPickerVars: [] as ResolvedVar[] };
    const all = [...vars.values()].sort((a, b) => SOURCE_RANK[a.sourceKind] - SOURCE_RANK[b.sourceKind]);
    const secrets = all.filter((v) => v.secret);
    const others = all.filter((v) => !v.secret);
    return {
      secretVars: secrets,
      otherVars: others,
      flatPickerVars: [...secrets, ...others],
    };
  }, [showVarPicker, vars]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

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

  const selectPickedVar = (key: string) => {
    const next = `{{${key}}}`;
    onChange(next);
    setPickerOpen(false);
    setAc(null);
    requestAnimationFrame(() => {
      const el = elRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.length, next.length);
        syncScroll();
      }
    });
  };

  const openPicker = () => {
    setAc(null);
    const curIdx = flatPickerVars.findIndex((item) => `{{${item.key}}}` === value.trim());
    setPickerIdx(curIdx >= 0 ? curIdx : 0);
    setPickerOpen(true);
    elRef.current?.focus();
  };

  const trimmedValue = value.trim();

  return (
    <div
      ref={wrapRef}
      className={`tpl-wrap ${bordered ? 'tpl-bordered' : ''} ${compact ? 'tpl-compact' : ''} ${className}`}
    >
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
            setPickerOpen(false);
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
            if (pickerOpen && flatPickerVars.length) {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setPickerIdx((i) => (i + 1) % flatPickerVars.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setPickerIdx((i) => (i - 1 + flatPickerVars.length) % flatPickerVars.length);
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                selectPickedVar(flatPickerVars[pickerIdx].key);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setPickerOpen(false);
                return;
              }
            }
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
            if (showVarPicker && !ac && !pickerOpen && e.key === 'ArrowDown') {
              e.preventDefault();
              openPicker();
              return;
            }
            if (e.key === 'Enter' && onEnter) {
              e.preventDefault();
              onEnter();
            }
          }}
          onBlur={() => setTimeout(() => setAc(null), 150)}
        />
      </div>

      {showVarPicker && (
        <button
          type="button"
          className={`tpl-picker-btn ${pickerOpen ? 'open' : ''}`}
          title="从已有密钥或变量中下拉选择"
          aria-haspopup="listbox"
          aria-expanded={pickerOpen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (pickerOpen) setPickerOpen(false);
            else openPicker();
          }}
        >
          <IconKey size={12} />
          <span>{varPickerLabel}</span>
          <IconChevronDown size={12} />
        </button>
      )}

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

      {showVarPicker && pickerOpen && (
        <div className="tpl-popover tpl-picker-pop" role="listbox">
          {flatPickerVars.length === 0 ? (
            <div className="tpl-pop-empty">当前作用域暂无可选密钥或变量，可直接输入明文或先添加密钥。</div>
          ) : (
            <>
              {secretVars.length > 0 && (
                <>
                  <div className="tpl-pop-group">密钥变量</div>
                  {secretVars.map((v, idx) => {
                    const selected = trimmedValue === `{{${v.key}}}`;
                    return (
                      <div
                        key={v.key}
                        role="option"
                        aria-selected={selected}
                        className={`tpl-pop-item ${idx === pickerIdx ? 'active' : ''} ${selected ? 'selected' : ''}`}
                        onMouseEnter={() => setPickerIdx(idx)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectPickedVar(v.key);
                        }}
                      >
                        <span className="tpl-pop-key" style={{ color: 'var(--var-secret-fg)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <IconKey size={11} />
                          {`{{${v.key}}}`}
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span className="tpl-pop-val">{formatVarDetail(v)}</span>
                          {selected && <IconCheck size={13} />}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}

              {otherVars.length > 0 && (
                <>
                  <div className="tpl-pop-group">{secretVars.length > 0 ? '其他可用变量' : '可用变量'}</div>
                  {otherVars.map((v, i) => {
                    const flatIdx = secretVars.length + i;
                    const selected = trimmedValue === `{{${v.key}}}`;
                    return (
                      <div
                        key={v.key}
                        role="option"
                        aria-selected={selected}
                        className={`tpl-pop-item ${flatIdx === pickerIdx ? 'active' : ''} ${selected ? 'selected' : ''}`}
                        onMouseEnter={() => setPickerIdx(flatIdx)}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectPickedVar(v.key);
                        }}
                      >
                        <span className="tpl-pop-key">{`{{${v.key}}}`}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span className="tpl-pop-val">{formatVarDetail(v)}</span>
                          {selected && <IconCheck size={13} />}
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          {varPickerActions && varPickerActions.length > 0 && (
            <div className="tpl-pop-footer">
              {varPickerActions.map((act) => (
                <button
                  key={act.label}
                  type="button"
                  className="menu-item"
                  style={{ fontSize: 12, padding: '5px 8px' }}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setPickerOpen(false);
                    act.onClick();
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <IconLayers size={12} />
                    {act.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
