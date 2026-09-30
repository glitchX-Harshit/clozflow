import { create } from 'zustand';

const usePearlStore = create((set, get) => ({
  leads: [],
  testLead: null,
  activeCallId: null,
  callState: 'idle', // idle, validating, preparing, dialing, connecting, active, completed, failed
  transcript: [],
  signals: [],
  objections: [],
  outcome: null,
  
  setCallState: (state) => set({ callState: state }),
  
  deployPearl: async (payload) => {
    set({ callState: 'validating', transcript: [], signals: [], objections: [], outcome: null });
    
    try {
      set({ callState: 'preparing' });
      const response = await fetch(`${window.APP_API_BASE || ''}/api/pearl/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        throw new Error('Deployment request failed');
      }
      
      const data = await response.json();
      set({ activeCallId: data.call_id, callState: 'dialing' });
      
      // We will connect websocket in the component when activeCallId is set
    } catch (e) {
      console.error(e);
      set({ callState: 'failed' });
    }
  },
  
  cancelCall: async () => {
    const { activeCallId } = get();
    if (!activeCallId) return;
    
    try {
      await fetch(`${window.APP_API_BASE || ''}/api/pearl/calls/${activeCallId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      set({ callState: 'cancelled' });
    } catch (e) {
      console.error(e);
    }
  },

  addTranscriptMessage: (msg) => set((state) => ({ transcript: [...state.transcript, msg] })),
  
  updateSignals: (signal) => set((state) => ({ signals: [...state.signals, signal] })),
  
  updateObjections: (obj) => set((state) => ({ objections: [...state.objections, obj] })),
}));

export default usePearlStore;
