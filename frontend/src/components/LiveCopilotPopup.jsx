import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import useCopilotStore from '../store/copilotStore';
import CopilotHud from '../pages/wizard/CopilotHud';
import { useHudHotkeys } from '../pages/wizard/hudHotkeys';
import './LiveCopilotPopup.css';

/**
 * LiveCopilotPopup — renders the copilot HUD into the external window.
 *
 * Mounted once at the App root. It reads the external window container from
 * the Zustand store and portals the HUD into it; the audio pipeline and the
 * card policy stay in the Live Call page (the main tab), so closing this window
 * never stops capture. Hotkeys are attached to the external document and the
 * primary button receives focus when the window opens.
 */
const LiveCopilotPopup = () => {
    const externalContainer = useCopilotStore((s) => s.externalContainer);
    const externalWindow = useCopilotStore((s) => s.externalWindow);
    const controls = useCopilotStore((s) => s.controls);
    const meter = useCopilotStore((s) => s.meter);
    const dockToPanel = useCopilotStore((s) => s.dockToPanel);
    const hidePopup = useCopilotStore((s) => s.hidePopup);
    const setAskOpen = useCopilotStore((s) => s.setAskOpen);

    const onWhatToSay = useCallback(() => controls.whatToSay?.(), [controls]);
    const onAsk = useCallback(() => setAskOpen(true), [setAskOpen]);
    const onEscape = useCallback(() => {
        const { askOpen, hud } = useCopilotStore.getState();
        if (askOpen) {
            setAskOpen(false);
            return true;
        }
        if (hud.card) {
            controls.dismiss?.();
            return true;
        }
        return false;
    }, [controls, setAskOpen]);

    useHudHotkeys(externalWindow?.document || null, { onWhatToSay, onAsk, onEscape });

    // Focus management: land on the primary action when the window opens.
    useEffect(() => {
        if (!externalContainer) return undefined;
        const id = setTimeout(() => {
            try {
                externalContainer.querySelector('[data-hud-primary]')?.focus();
            } catch {
                // The window may be closing.
            }
        }, 60);
        return () => clearTimeout(id);
    }, [externalContainer]);

    if (!externalContainer) return null;

    return createPortal(
        <div className="copilot-popup">
            <CopilotHud compact dark onDock={dockToPanel} onClose={hidePopup} meter={meter || null} />
        </div>,
        externalContainer,
    );
};

export default LiveCopilotPopup;
