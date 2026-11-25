import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export function hearingDraftOwner(actorId: string, command: 'cancel' | 'reschedule', hearingId: string) {
  return `${actorId}:${command}-hearing${hearingId}`;
}

export function isUncertainHearingOutcome(code?: string): boolean {
  return !code || ['INTERNAL_ERROR', 'IDEMPOTENCY_CONCURRENT_CONFLICT'].includes(code);
}

/**
 * Shared modal lifecycle: initial focus, locking #app-shell-content via inert/aria-hidden,
 * Escape close, and focus trapping including anchor recovery links.
 */
export function useHearingModalEffects(options: {
  isOpen: boolean;
  isSubmitting?: boolean;
  hasPending: boolean;
  onClose: () => void;
  dialogRef: RefObject<HTMLDivElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
}) {
  const { isOpen, isSubmitting = false, hasPending, onClose, dialogRef, initialFocusRef } = options;
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const shell = document.getElementById('app-shell-content') as (HTMLElement & { inert: boolean }) | null;
    const prevInert = shell?.inert ?? false;
    const prevHidden = shell?.getAttribute('aria-hidden') ?? null;
    if (shell) {
      shell.inert = true;
      shell.setAttribute('aria-hidden', 'true');
    }

    return () => {
      if (shell) {
        shell.inert = prevInert;
        if (prevHidden === null) shell.removeAttribute('aria-hidden');
        else shell.setAttribute('aria-hidden', prevHidden);
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || isSubmitting) return;
    const frameId = requestAnimationFrame(() => {
      if (hasPending) {
        const submitBtn = dialogRef.current?.querySelector<HTMLButtonElement>('button[type="submit"]:not([disabled])');
        if (submitBtn) {
          submitBtn.focus();
          return;
        }
      }
      initialFocusRef.current?.focus();
    });
    return () => cancelAnimationFrame(frameId);
  }, [isOpen, isSubmitting, hasPending, dialogRef, initialFocusRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isSubmitting) {
          e.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;

        const focusables = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, dialogRef]);
}

export function renderHearingModalPortal(node: ReactNode) {
  if (typeof document === 'undefined') return null;
  return createPortal(node, document.getElementById('app-shell-modal-root') ?? document.body);
}
