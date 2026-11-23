import React, { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { IconX } from './Icons';

export const ConfirmDialog: React.FC = () => {
  const { dialog, closeDialog } = useAppStore();
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dialog) return;
    if (dialog.kind === 'prompt') {
      setInputValue(dialog.defaultValue ?? '');
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else {
      requestAnimationFrame(() => {
        confirmBtnRef.current?.focus();
      });
    }
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog(dialog.kind === 'prompt' ? null : false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, closeDialog]);

  if (!dialog) return null;

  const handleConfirm = () => {
    if (dialog.kind === 'prompt') {
      if (!inputValue.trim()) return;
      closeDialog(inputValue);
    } else {
      closeDialog(true);
    }
  };

  const handleCancel = () => {
    closeDialog(dialog.kind === 'prompt' ? null : false);
  };

  return (
    <div
      className="modal-mask"
      style={{ zIndex: 220 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div className="modal modal-sm" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{dialog.title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={handleCancel} title="关闭">
            <IconX size={16} />
          </button>
        </div>

        <div className="modal-body">
          {dialog.message && (
            <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.55 }}>
              {dialog.message}
            </p>
          )}
          {dialog.kind === 'prompt' && (
            <input
              ref={inputRef}
              className="input"
              style={{ width: '100%' }}
              value={inputValue}
              placeholder={dialog.placeholder}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
            />
          )}
        </div>

        <div className="modal-foot">
          <div />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={handleCancel}>
              {dialog.cancelLabel ?? '取消'}
            </button>
            <button
              ref={confirmBtnRef}
              className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleConfirm}
              disabled={dialog.kind === 'prompt' && !inputValue.trim()}
            >
              {dialog.confirmLabel ?? '确定'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
