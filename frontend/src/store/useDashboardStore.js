import { create } from 'zustand';
import { DEFAULT_DASHBOARD_TAB, DEFAULT_PEARL_SECTION, PEARL_SECTIONS, SETTINGS_PANELS } from '../lib/dashboardLinks';

/**
 * Dashboard navigation state. Mirrored into the URL by the Dashboard
 * (`/dashboard?tab=…&section=…`), so tabs can be deep-linked and survive a reload.
 * Other screens may call `setActiveTab` before navigating to `/dashboard`.
 */
export const useDashboardStore = create((set) => ({
    activeTab: DEFAULT_DASHBOARD_TAB,
    pearlSection: DEFAULT_PEARL_SECTION,
    settingsPanel: null,
    setActiveTab: (tab) => set({ activeTab: tab }),
    setPearlSection: (section) => set({ pearlSection: PEARL_SECTIONS.includes(section) ? section : DEFAULT_PEARL_SECTION }),
    setSettingsPanel: (panel) => set({ settingsPanel: SETTINGS_PANELS.includes(panel) ? panel : null }),
    /** Apply a parsed `?tab=&section=` link (see lib/dashboardLinks). */
    applyDeepLink: (tab, section) => set((state) => ({
        activeTab: tab,
        pearlSection: tab === 'pearl' && section ? section : state.pearlSection,
        settingsPanel: tab === 'settings' ? (section || null) : state.settingsPanel,
    })),
}));
