import { create } from 'zustand';

export const useLeadFinderStore = create((set) => ({
    query: '',
    setQuery: (query) => set({ query }),
    
    leads: [],
    setLeads: (leads) => set({ leads, lastUpdated: Date.now() }),
    
    searched: false,
    setSearched: (searched) => set({ searched }),
    
    activeFilters: {},
    setActiveFilters: (filtersOrUpdater) => set((state) => {
        if (typeof filtersOrUpdater === 'function') {
            return { activeFilters: filtersOrUpdater(state.activeFilters) };
        }
        return { activeFilters: filtersOrUpdater };
    }),
    
    userOffer: '',
    setUserOffer: (userOffer) => set({ userOffer }),
    
    customOffer: '',
    setCustomOffer: (customOffer) => set({ customOffer }),
    
    searchMode: 'high_fit_leads',
    setSearchMode: (searchMode) => set({ searchMode }),
    
    viewMode: 'discover',
    setViewMode: (viewMode) => set({ viewMode }),

    scrollPosition: 0,
    setScrollPosition: (scrollPosition) => set({ scrollPosition }),

    lastUpdated: null,
}));
