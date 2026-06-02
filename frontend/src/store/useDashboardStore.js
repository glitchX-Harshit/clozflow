import { create } from 'zustand';

export const useDashboardStore = create((set) => ({
    activeTab: 'overview',
    setActiveTab: (tab) => set({ activeTab: tab }),
}));
