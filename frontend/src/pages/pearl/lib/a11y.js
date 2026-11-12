/**
 * Small accessibility helpers shared by Pearl dialogs and clickable rows.
 *
 *   const { ref, dialogProps } = useDialogA11y(isOpen, onClose);
 *   <div className="backdrop" {...backdrop}>
 *     <div className="box" ref={ref} {...dialogProps} aria-labelledby="my-title"> … </div>
 *   </div>
 *
 * - role="dialog" + aria-modal, focus moves into the dialog on open and returns
 *   to the opener on close, Tab / Shift+Tab stay inside, Esc closes the top-most
 *   open dialog only (unless a widget inside it already handled the key).
 * - `useBackdropDismiss(onClose)` closes on a backdrop click only when the press
 *   started on the backdrop too (a text selection dragged out of the dialog
 *   does not close it).
 */
import { useEffect, useRef } from 'react';

const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
].join(',');

const OPEN_ATTR = 'data-pearl-dialog';

function focusableIn(node) {
    if (!node) return [];
    return Array.from(node.querySelectorAll(FOCUSABLE)).filter(
        (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true' && (el.offsetParent !== null || el === document.activeElement),
    );
}

/**
 * @param {boolean} open
 * @param {() => void} onClose  called on Esc (pass null to disable Esc)
 * @param {{ initialFocusRef?: { current: HTMLElement|null } }} [options]
 */
export function useDialogA11y(open, onClose, { initialFocusRef } = {}) {
    const ref = useRef(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    });

    useEffect(() => {
        if (!open || typeof document === 'undefined') return undefined;
        const previous = document.activeElement;
        const frame = requestAnimationFrame(() => {
            const node = ref.current;
            if (!node) return;
            const target = initialFocusRef?.current || node.querySelector('[data-autofocus]') || node;
            if (!node.contains(document.activeElement)) target.focus?.({ preventScroll: true });
        });

        // Bubble phase on document: widgets inside the dialog (dropdowns, inline editors) see the
        // key first; if they handle Esc they call preventDefault()/stopPropagation() and the
        // dialog stays open.
        const onKeyDown = (event) => {
            const node = ref.current;
            if (!node || event.defaultPrevented) return;
            const openDialogs = document.querySelectorAll(`[${OPEN_ATTR}="open"]`);
            if (openDialogs.length && openDialogs[openDialogs.length - 1] !== node) return; // not the top-most
            if (event.key === 'Escape' || event.key === 'Esc') {
                if (typeof onCloseRef.current === 'function') {
                    event.preventDefault();
                    onCloseRef.current();
                }
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusableIn(node);
            if (items.length === 0) {
                event.preventDefault();
                node.focus?.({ preventScroll: true });
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !node.contains(active))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (active === last || !node.contains(active))) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener('keydown', onKeyDown);
            if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
                previous.focus({ preventScroll: true });
            }
        };
    }, [open, initialFocusRef]);

    return {
        ref,
        dialogProps: {
            role: 'dialog',
            'aria-modal': 'true',
            tabIndex: -1,
            [OPEN_ATTR]: open ? 'open' : 'closed',
        },
    };
}

/** Backdrop props that close only on a real backdrop click (press and release on the backdrop). */
export function useBackdropDismiss(onClose) {
    const pressedOnBackdrop = useRef(false);
    return {
        onMouseDown: (event) => {
            pressedOnBackdrop.current = event.target === event.currentTarget;
        },
        onClick: (event) => {
            const shouldClose = pressedOnBackdrop.current && event.target === event.currentTarget;
            pressedOnBackdrop.current = false;
            if (shouldClose && typeof onClose === 'function') onClose();
        },
    };
}

/** onKeyDown handler that runs `handler` on Enter / Space (for role="button" elements). */
export function keyActivate(handler) {
    return (event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            handler(event);
        }
    };
}

/** Props that make a non-button element operable like a button. */
export function buttonRoleProps(handler, { label, disabled = false } = {}) {
    return {
        role: 'button',
        tabIndex: disabled ? -1 : 0,
        'aria-disabled': disabled || undefined,
        'aria-label': label,
        onClick: disabled ? undefined : handler,
        onKeyDown: disabled ? undefined : keyActivate(handler),
    };
}
