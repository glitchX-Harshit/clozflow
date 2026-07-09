/**
 * openCopilotWindow — Opens a real browser window for the copilot popup.
 *
 * Priority:
 *   1. Document Picture-in-Picture API (Chrome/Edge 116+)
 *      → True always-on-top OS window
 *   2. window.open() fallback
 *      → Separate popup window, persists across tab switches
 *
 * MUST be called from a user gesture (click handler) or browsers will block it.
 *
 * @returns {{ win: Window, container: HTMLElement } | null}
 */
export async function openCopilotWindow() {
    // ─── 1. Try Document Picture-in-Picture API ───
    // Try Document Picture-in-Picture API for a native desktop window feel
    if ('documentPictureInPicture' in window) {
        try {
            const pipWin = await window.documentPictureInPicture.requestWindow({
                width: 400,
                height: 440,
            });

            injectStyles(pipWin);
            const container = createRoot(pipWin);

            pipWin.document.title = 'ClozFlow Copilot';

            return { win: pipWin, container };
        } catch (err) {
            console.warn('[Copilot] Document PiP unavailable:', err.message);
        }
    }

    // ─── 2. Fallback: window.open() ───
    try {
        const left = window.screenX + window.innerWidth - 440;
        const top = window.screenY + 60;
        const popup = window.open(
            '/copilot.html',
            'ClozFlowCopilot',
            `popup=yes,width=400,height=440,left=${left},top=${top},resizable=yes,scrollbars=no`
        );

        if (popup) {
            return new Promise((resolve) => {
                // Wait for the new document to load before injecting
                popup.onload = () => {
                    popup.document.title = 'ClozFlow Copilot';
                    injectStyles(popup);
                    // copilot-root is already in copilot.html, but if not we can use it
                    let container = popup.document.getElementById('copilot-root');
                    if (!container) {
                        container = createRoot(popup);
                    }
                    resolve({ win: popup, container });
                };
                
                // Fallback in case onload already fired or fails
                setTimeout(() => {
                    if (popup.document.readyState === 'complete') {
                        popup.document.title = 'ClozFlow Copilot';
                        injectStyles(popup);
                        let container = popup.document.getElementById('copilot-root') || createRoot(popup);
                        resolve({ win: popup, container });
                    }
                }, 1000);
            });
        }
    } catch (err) {
        console.warn('[Copilot] window.open failed:', err.message);
    }

    return null;
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
    // Google Fonts
    const fontLink = externalWin.document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href =
        'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap';
    externalWin.document.head.appendChild(fontLink);

    // Copy all stylesheets from the main window
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
            background: rgba(12, 12, 16, 0.92);
            overflow: hidden;
            width: 100%;
            height: 100%;
            font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
            -webkit-font-smoothing: antialiased;
        }
        body { display: flex; }
        #copilot-root {
            width: 100%;
            height: 100%;
            display: flex;
        }
        /* Popup fills external window fully */
        .copilot-popup {
            border-radius: 0 !important;
            width: 100% !important;
            height: 100% !important;
            border: none !important;
            box-shadow: none !important;
            background: rgba(12, 12, 16, 0.95) !important;
        }
        .copilot-popup__header {
            cursor: default !important;
        }
        .copilot-popup__resize-handle { display: none !important; }
    `;
    externalWin.document.head.appendChild(overrides);
}
