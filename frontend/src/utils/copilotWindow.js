import useCopilotStore from '../store/copilotStore';

/**
 * openCopilotWindow — Opens a real browser window for the copilot HUD.
 *
 * Priority:
 *   1. Document Picture-in-Picture API (Chrome/Edge 116+)
 *      → True always-on-top OS window (dies with the opener tab; the audio
 *        pipeline stays in the main tab so closing it never stops capture)
 *   2. window.open() fallback
 *      → Separate popup window, persists across tab switches
 *
 * MUST be called from a user gesture (click handler) or browsers will block it.
 * Closing the window from its own controls (PiP close / "back to tab", or the
 * popup's close button) fires `pagehide`, which resets the store so the docked
 * panel shows guidance again.
 *
 * @returns {Promise<{ win: Window, container: HTMLElement } | null>}
 */
const POPUP_READY_TIMEOUT_MS = 3000;
const POPUP_POLL_MS = 100;
/** Default HUD size; the layout keeps working down to 360×300. */
export const PIP_WIDTH = 420;
export const PIP_HEIGHT = 380;

function watchForClose(win) {
    try {
        win.addEventListener('pagehide', () => useCopilotStore.getState().handleExternalClosed(win), { once: true });
    } catch {
        // A window we cannot reach cannot be watched; the dock button still works.
    }
}

export async function openCopilotWindow() {
    // ─── 1. Document Picture-in-Picture API ───
    if ('documentPictureInPicture' in window) {
        try {
            const pipWin = await window.documentPictureInPicture.requestWindow({
                width: PIP_WIDTH,
                height: PIP_HEIGHT,
            });

            injectStyles(pipWin);
            const container = createRoot(pipWin);
            pipWin.document.title = 'ClozFlow Copilot';
            pipWin.document.documentElement.lang = 'en';
            watchForClose(pipWin);

            return { win: pipWin, container };
        } catch (err) {
            console.warn('[Copilot] Document PiP unavailable:', err.message);
        }
    }

    // ─── 2. Fallback: window.open() ───
    let popup = null;
    try {
        const left = window.screenX + window.innerWidth - PIP_WIDTH - 40;
        const top = window.screenY + 60;
        popup = window.open(
            '/copilot.html',
            'ClozFlowCopilot',
            `popup=yes,width=${PIP_WIDTH},height=${PIP_HEIGHT},left=${left},top=${top},resizable=yes,scrollbars=no`
        );
    } catch (err) {
        console.warn('[Copilot] window.open failed:', err.message);
        return null;
    }
    if (!popup) return null;

    return new Promise((resolve) => {
        let done = false;
        let poll = null;
        const startedAt = Date.now();

        const finish = (result) => {
            if (done) return;
            done = true;
            if (poll) clearInterval(poll);
            resolve(result);
        };

        const ready = () => {
            try {
                const doc = popup.document;
                // The popup starts on about:blank; wait for copilot.html itself.
                if (doc.readyState !== 'complete' || doc.location.href === 'about:blank') return false;
                doc.title = 'ClozFlow Copilot';
                injectStyles(popup);
                const container = doc.getElementById('copilot-root') || createRoot(popup);
                watchForClose(popup);
                finish({ win: popup, container });
                return true;
            } catch {
                return false;
            }
        };

        poll = setInterval(() => {
            if (done) return;
            if (popup.closed) {
                finish(null);
                return;
            }
            if (ready()) return;
            if (Date.now() - startedAt >= POPUP_READY_TIMEOUT_MS) {
                try {
                    popup.close();
                } catch {
                    // ignore
                }
                finish(null);
            }
        }, POPUP_POLL_MS);
    });
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────────────────────────────────── */

/** Create the root container element in the external window */
function createRoot(externalWin) {
    const container = externalWin.document.createElement('div');
    container.id = 'copilot-root';
    externalWin.document.body.appendChild(container);
    return container;
}

/** Inject all required styles into the external window */
function injectStyles(externalWin) {
    // Copy all stylesheets from the main window (the HUD styles live in LiveCopilotPopup.css).
    [...document.styleSheets].forEach((sheet) => {
        try {
            const cssText = [...sheet.cssRules].map((r) => r.cssText).join('\n');
            const style = externalWin.document.createElement('style');
            style.textContent = cssText;
            externalWin.document.head.appendChild(style);
        } catch {
            // Cross-origin sheet → link it
            if (sheet.href) {
                const link = externalWin.document.createElement('link');
                link.rel = 'stylesheet';
                link.href = sheet.href;
                externalWin.document.head.appendChild(link);
            }
        }
    });

    // External window overrides — fills the entire window
    const overrides = externalWin.document.createElement('style');
    overrides.textContent = `
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
            background: #0b0f17; /* a solid colour is required on Windows PiP to avoid the white fallback */
            overflow: hidden;
            width: 100%;
            height: 100%;
            font-family: 'Prodigy Sans', 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
            -webkit-font-smoothing: antialiased;
        }
        body { display: flex; }
        #copilot-root {
            width: 100%;
            height: 100%;
            display: flex;
        }
        .copilot-popup {
            border-radius: 0 !important;
            width: 100% !important;
            height: 100% !important;
            border: none !important;
            box-shadow: none !important;
        }
    `;
    externalWin.document.head.appendChild(overrides);
}
