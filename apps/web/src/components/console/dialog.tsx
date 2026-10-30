'use client';

import { XIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Buttons, right-aligned on wide screens and stacked full width on phones. */
  footer?: ReactNode;
  size?: 'md' | 'lg';
  /** While work is in flight the dialog cannot be dismissed. */
  closeDisabled?: boolean;
}

/**
 * A modal that fits any width: a full-height sheet from the bottom on phones, a centred box on
 * wider screens, with its own scrolling body so long forms never overflow the viewport. Escape,
 * the close button and a click on the backdrop close it.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'lg',
  closeDisabled = false,
}: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  // Focus and scroll lock once, when the dialog opens; restore both when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !closeDisabled) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, closeDisabled]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-corp-ink/60 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-dvh w-full flex-col border border-corp-line bg-white shadow-panel outline-none sm:max-h-[calc(100dvh-3rem)] ${
          size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl'
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-corp-line px-4 py-3 md:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="font-corporate text-h3 text-corp-ink">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-sm text-corp-text">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close dialog"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-none border border-corp-line bg-white text-corp-ink hover:bg-corp-surface disabled:opacity-50"
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">{children}</div>
        {footer ? (
          <footer className="flex flex-col gap-2 border-t border-corp-line px-4 py-3 sm:flex-row sm:justify-end md:px-6">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
