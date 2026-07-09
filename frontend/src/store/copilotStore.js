import { create } from 'zustand';

/**
 * Global Copilot Popup Store (Zustand)
 *
 * Manages the copilot popup state globally.
 * Supports two modes:
 *   - EXTERNAL: rendered in a separate browser window (PiP / popup)
 *   - DOCKED:   rendered inside the LiveCall dashboard panel
 *
 * LiveCall pushes AI data here → LiveCopilotPopup reads + renders.
 */
const useCopilotStore = create((set, get) => ({
    // ── Visibility & Mode ──
    isPopupVisible: false,   // true = copilot is in external window
    isListening: false,

    // ── External window refs ──
    externalWindow: null,    // The Window object (PiP or popup)
    externalContainer: null, // The DOM node inside that window for portal

    // ── AI Data ──
    latestSuggestion: null,
    suggestionCount: 0,
    reasoningData: null,

    // ── Active Sessions ──
    activeSessions: [],

    // ── Actions ──

    /** Store the external window references after opening */
    setExternalRefs: (win, container) =>
        set({ externalWindow: win, externalContainer: container, isPopupVisible: true }),

    /** Dock back: close external window, show docked panel */
    dockToPanel: () => {
        const { externalWindow } = get();
        if (externalWindow) { try { externalWindow.close(); } catch {} }
        set({ externalWindow: null, externalContainer: null, isPopupVisible: false });
    },

    /** Hide popup + close external window */
    hidePopup: () => {
        const { externalWindow } = get();
        if (externalWindow) { try { externalWindow.close(); } catch {} }
        set({ isPopupVisible: false, externalWindow: null, externalContainer: null });
    },

    showPopup: () => set({ isPopupVisible: true }),

    setListening: (val) => set({ isListening: val }),

    pushSuggestion: (suggestion) =>
        set((s) => ({
            latestSuggestion: suggestion,
            suggestionCount: s.suggestionCount + 1,
        })),

    setReasoningData: (data) => set({ reasoningData: data }),

    fetchActiveSessions: async () => {
        try {
            const token = localStorage.getItem('token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;
            
            const API_BASE = 'http://localhost:8000';
            const res = await fetch(`${API_BASE}/api/copilot/sessions/active`, { headers });
            if (res.ok) {
                const data = await res.json();
                set({ activeSessions: data || [] });
            } else {
                set({ activeSessions: [] });
            }
        } catch (error) {
            console.error('Failed to fetch copilot status:', error);
            set({ activeSessions: [] });
        }
    },

    removeActiveSession: (sessionId) => 
        set((state) => ({
            activeSessions: state.activeSessions.filter(s => s.session_id !== sessionId)
        })),

    /** Reset everything when the session ends */
    resetCopilot: () => {
        const { externalWindow } = get();
        if (externalWindow) { try { externalWindow.close(); } catch {} }
        set({
            isPopupVisible: false,
            isListening: false,
            latestSuggestion: null,
            suggestionCount: 0,
            reasoningData: null,
            externalWindow: null,
            externalContainer: null,
        });
    },
}));

export default useCopilotStore;
