import { create } from 'zustand';

const closeWindow = (win) => {
    if (!win) return;
    try {
        win.close();
    } catch {
        // The window may already be gone (closed by the user or the browser).
    }
};

const EMPTY_HUD = { card: null, pinned: null, previous: null, chips: [], snoozed: [], history: [], hovering: false, remainingMs: null };

/**
 * Global Copilot Store (Zustand)
 *
 * The Live Call page owns the audio controller and the card policy; it pushes
 * the HUD state here. `CopilotHud` renders it both inside the page and inside
 * the external Picture-in-Picture window (via `LiveCopilotPopup`), and calls
 * back through `controls` (set by the page) so the two surfaces stay in sync.
 *
 * Legacy fields (`latestSuggestion`, `notice`) remain for old servers that only
 * send `aiAnalysis`; the page maps them into the same card shape.
 */
const useCopilotStore = create((set, get) => ({
    // ── Visibility & Mode ──
    isPopupVisible: false,   // true = copilot is in external window
    isListening: false,
    hasStarted: false,
    connectionState: 'idle', // idle | connecting | connected | reconnecting | failed

    // ── External window refs ──
    externalWindow: null,    // The Window object (PiP or popup)
    externalContainer: null, // The DOM node inside that window for portal

    // ── Legacy AI data (aiAnalysis) ──
    latestSuggestion: null,
    suggestionCount: 0,
    notice: null,            // { status, message } for turns without a new suggestion
    noticeIsNewer: false,    // the notice belongs to a newer turn than latestSuggestion

    // ── Now-card HUD (protocol v2) ──
    hud: EMPTY_HUD,          // cardPolicy snapshot
    strip: null,             // { label, askNext, stage }
    intensity: 'guided',     // full | guided | light | on_demand | off
    features: [],            // from `ready`
    protocol: null,          // 0 waiting · 1 legacy framing · 2 coach
    engine: null,            // ready.engine / stt vendor for the status line
    nudge: null,             // { id, kind, text }
    dealRecord: null,        // mapDealRecord()
    roundTripMs: null,       // measured ping → pong
    askOpen: false,
    askPending: false,       // waiting for the answer to an ask / what_to_say
    meeting: null,           // { title, prospectName, company }
    battlecards: {},         // id → battlecard (for "Open card")
    controls: {},            // set by the Live Call page
    meter: null,             // levelBus for the idle-state level meter

    // ── Actions ──

    /** Store the external window references after opening */
    setExternalRefs: (win, container) =>
        set({ externalWindow: win, externalContainer: container, isPopupVisible: true }),

    /** The external window was closed by the user or the browser (pagehide). */
    handleExternalClosed: (win) => {
        if (get().externalWindow !== win) return;
        set({ externalWindow: null, externalContainer: null, isPopupVisible: false });
    },

    /** Dock back: close external window, show docked panel */
    dockToPanel: () => {
        const { externalWindow } = get();
        set({ externalWindow: null, externalContainer: null, isPopupVisible: false });
        closeWindow(externalWindow);
    },

    /** Hide popup + close external window */
    hidePopup: () => {
        const { externalWindow } = get();
        set({ isPopupVisible: false, externalWindow: null, externalContainer: null });
        closeWindow(externalWindow);
    },

    setListening: (val) => set({ isListening: val }),

    setConnectionState: (connectionState) => set({ connectionState }),

    /** Mirror the Live Call state (used when the window opens mid-call). */
    syncFromCall: (partial) => set(partial),

    pushSuggestion: (suggestion) =>
        set((s) => ({
            latestSuggestion: suggestion,
            suggestionCount: s.suggestionCount + 1,
            notice: null,
            noticeIsNewer: false,
        })),

    setNotice: (notice) => set({ notice, noticeIsNewer: !!notice }),

    setHud: (hud) => set({ hud: hud || EMPTY_HUD }),
    setStrip: (strip) => set({ strip }),
    setIntensity: (intensity) => set({ intensity }),
    setFeatures: ({ features, protocol, engine }) => set((s) => ({
        features: Array.isArray(features) ? features : s.features,
        protocol: protocol ?? s.protocol,
        engine: engine ?? s.engine,
    })),
    setNudge: (nudge) => set({ nudge }),
    setDealRecord: (dealRecord) => set({ dealRecord }),
    setRoundTrip: (roundTripMs) => set({ roundTripMs }),
    setAskOpen: (askOpen) => set({ askOpen }),
    setAskPending: (askPending) => set({ askPending }),
    setMeeting: (meeting) => set({ meeting }),
    setBattlecards: (list) => set({
        battlecards: Object.fromEntries((Array.isArray(list) ? list : []).filter((c) => c && c.id).map((c) => [c.id, c])),
    }),
    setControls: (controls) => set({ controls: controls || {} }),
    setMeter: (meter) => set({ meter }),

    /** Reset everything when the session ends */
    resetCopilot: () => {
        const { externalWindow } = get();
        set({
            isPopupVisible: false,
            isListening: false,
            hasStarted: false,
            connectionState: 'idle',
            latestSuggestion: null,
            suggestionCount: 0,
            notice: null,
            noticeIsNewer: false,
            externalWindow: null,
            externalContainer: null,
            hud: EMPTY_HUD,
            strip: null,
            features: [],
            protocol: null,
            engine: null,
            nudge: null,
            dealRecord: null,
            roundTripMs: null,
            askOpen: false,
            askPending: false,
            meeting: null,
            battlecards: {},
            controls: {},
            meter: null,
        });
        closeWindow(externalWindow);
    },
}));

export default useCopilotStore;
