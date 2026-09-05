import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Focus lifecycle shared by destructive confirmation overlays. */
export function useModalDialog<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const initial = dialog.querySelector<HTMLElement>('[data-dialog-initial-focus]')
      ?? focusable()[0]
      ?? dialog;
    initial.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [open]);

  return dialogRef;
}
