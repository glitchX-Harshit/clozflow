import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * useLeadIntelligenceStore
 * ─────────────────────────
 * Manages all state for the Lead Intelligence side panel.
 * Intentionally separate from useLeadFinderStore to keep
 * the intelligence layer modular and independently replaceable.
 */
export const useLeadIntelligenceStore = create(
    persist(
        (set, get) => ({
            // ── Panel UI state ─────────────────────────────────────────────
            isPanelOpen: false,
            togglePanel: () => set((s) => ({ isPanelOpen: !s.isPanelOpen })),
            openPanel: () => set({ isPanelOpen: true }),
            closePanel: () => set({ isPanelOpen: false }),

            panelWidth: 380,
            setPanelWidth: (panelWidth) => set({ panelWidth }),

            // ── Panel view state ───────────────────────────────────────────
            // 'empty' | 'understanding' | 'icp' | 'active' | 'results' | 'lead'
            panelState: 'empty',
            setPanelState: (panelState) => set({ panelState }),

            // ── User offer input (for ICP discovery) ──────────────────────
            offerInput: '',
            setOfferInput: (offerInput) => set({ offerInput }),

            // ── ICP data ───────────────────────────────────────────────────
            icp: null,
            // icp shape: {
            //   primaryCustomer: string,
            //   segments: string[],
            //   likelyBuyers: string[],
            //   usefulSignals: string[],
            //   derivedFrom: string,
            // }
            setIcp: (icp) => set({ icp, panelState: 'icp' }),
            clearIcp: () => set({ icp: null, panelState: 'empty', messages: [] }),

            // ── Conversation messages ──────────────────────────────────────
            messages: [],
            addMessage: (msg) => set((s) => ({
                messages: [...s.messages, { ...msg, id: Date.now() }]
            })),
            clearMessages: () => set({ messages: [] }),

            // ── Contextual suggestions (dynamic per search) ────────────────
            suggestions: [],
            setSuggestions: (suggestions) => set({ suggestions }),

            // ── Results summary ────────────────────────────────────────────
            resultsSummary: null,
            // resultsSummary: { total, highRelevance, strongSignals }
            setResultsSummary: (resultsSummary) => set({ resultsSummary }),

            // ── Currently selected lead (for Lead Analysis state) ──────────
            analyzedLead: null,
            setAnalyzedLead: (analyzedLead) => set({
                analyzedLead,
                panelState: analyzedLead ? 'lead' : get().panelState
            }),

            // ── Loading state ──────────────────────────────────────────────
            isLoading: false,
            setIsLoading: (isLoading) => set({ isLoading }),

            // ── Loading step text ──────────────────────────────────────────
            loadingStep: '',
            setLoadingStep: (loadingStep) => set({ loadingStep }),
        }),
        {
            name: 'lead-intelligence-panel',
            // Only persist ICP and panel open state
            partialize: (state) => ({
                icp: state.icp,
                offerInput: state.offerInput,
                panelState: state.panelState === 'understanding' || state.panelState === 'active'
                    ? (state.icp ? 'icp' : 'empty')
                    : state.panelState,
                isPanelOpen: state.isPanelOpen,
                panelWidth: state.panelWidth ?? 380,
                messages: state.messages?.slice(-20) ?? [], // keep last 20 messages
            }),
        }
    )
);
