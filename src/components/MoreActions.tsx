import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { IconMore } from './Icons';

export function MoreActions({ label, small, children }: { label: string; small?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', outside);
    document.addEventListener('click', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('click', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className="dropdown-wrap" ref={wrap}>
      <button ref={trigger} className={`btn btn-ghost btn-icon${small ? ' btn-sm' : ''}`} title={label} aria-label={label}
        aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(!open)}>
        <IconMore size={14} />
      </button>
      {open && <div id={menuId} className="menu-pop right" role="group" aria-label={label} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}
