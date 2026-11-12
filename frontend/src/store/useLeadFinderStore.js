import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useLeadFinderStore = create(
    persist(
        (set) => ({
            query: '',
            setQuery: (query) => set({ query }),

            leads: [],
            setLeads: (leads) => set({ leads, lastUpdated: Date.now() }),

            /** True when the server flagged the current results as sample (fake) data. */
            resultsSample: false,
            setResultsSample: (resultsSample) => set({ resultsSample }),

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

            /** Query of the last search that completed (drives Intelligence suggestions). */
            lastSearchedQuery: '',
            setLastSearchedQuery: (lastSearchedQuery) => set({ lastSearchedQuery }),

            /**
             * Search requested by another component (the Intelligence chat). Lead Finder
             * runs it with the store's current mode, filters and offer.
             */
            searchRequest: null,
            requestSearch: (query) => set((state) => ({
                searchRequest: { id: (state.searchRequest?.id ?? 0) + 1, query },
            })),

            searchHistory: [],
            addSearchHistory: (record) => set((state) => {
                const filtered = state.searchHistory.filter(h => h.query.toLowerCase() !== record.query.toLowerCase());
                return { searchHistory: [record, ...filtered].slice(0, 10) };
            }),
            clearSearchHistory: () => set({ searchHistory: [] }),
        }),
        {
            name: 'lead-finder-history',
            partialize: (state) => ({ searchHistory: state.searchHistory || [] }),
        }
    )
);
