import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  label: string;
  trigger: ReactNode;
  menuClass: string;
  iconOnly?: boolean;
  disabled?: boolean;
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}

export function ResponseDropdown({ label, trigger, menuClass, iconOnly, disabled, onOpen, children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    const anchor = root.current;
    const menu = popup.current;
    const pane = anchor?.closest('.pane');
    if (!open || !anchor || !menu || !pane) return;
    const fit = () => {
      const bounds = pane.getBoundingClientRect();
      const trigger = anchor.getBoundingClientRect();
      menu.style.setProperty('--response-menu-height', `${Math.max(0, bounds.bottom - trigger.bottom - 8)}px`);
      menu.style.setProperty('--response-menu-width', `${Math.max(0, bounds.width - 8)}px`);
      const leftOverflow = bounds.left + 4 - (trigger.right - menu.offsetWidth);
      menu.style.right = `${-Math.max(0, leftOverflow)}px`;
    };
    fit();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    observer?.observe(pane);
    return () => observer?.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
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
    <div className="dropdown-wrap" ref={root}>
      <button ref={button} className={`btn btn-ghost btn-sm${iconOnly ? ' btn-icon' : ''}`}
        title={label} aria-label={iconOnly ? label : undefined} disabled={disabled}
        aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { if (!open) onOpen?.(); setOpen(!open); }}>
        {trigger}
      </button>
      {open && <div ref={popup} id={id} role="group" aria-label={label} className={`menu-pop right ${menuClass}`}>
        {children(() => setOpen(false))}
      </div>}
    </div>
  );
}
