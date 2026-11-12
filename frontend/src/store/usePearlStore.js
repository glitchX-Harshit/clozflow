import { create } from 'zustand';
import { apiFetch, errorMessage } from '../pages/pearl/lib/pearlApi.js';
import { normalizeCallStatus, mapCallStatus } from '../pages/pearl/lib/callStatus.js';
import {
  describeDeployError,
  isTerminalPhase,
  normalizeTranscriptEntry,
  reduceCallStatus,
} from '../pages/pearl/lib/dialpad.js';

/**
 * Dialpad console state (one outbound call at a time).
 *
 * phase: idle → dispatching (request in flight, no call id) → dialing / ringing →
 *        connected → completed | cancelled | failed
 *
 * `dispatchSeq` changes on every deploy / reset / cancel-while-dispatching, so a
 * late `/deploy` response for an abandoned dispatch is ignored — and the call it
 * created is cancelled right away instead of ringing unseen.
 */

const MAX_TRANSCRIPT = 500;

const IDLE_CALL = Object.freeze({
  phase: 'idle',
  activeCallId: null,
  callStatus: null,
  errorCode: null,
  duration: null,
  connectedAt: null,
  endedAt: null,
  transcript: [],
  callMeta: null, // { phone, recipientName, agentLabel, provider }
  liveMode: 'socket', // 'socket' | 'polling' | 'stopped'
  liveError: null,
  cancelling: false,
  actionError: null,
});

const statusPatch = (status, now = Date.now()) => {
  const mapped = mapCallStatus(status);
  return {
    callStatus: mapped.status,
    phase: mapped.phase,
    ...(mapped.terminal ? { endedAt: now } : {}),
  };
};

const callPath = (callId) => `/api/pearl/calls/${encodeURIComponent(callId)}`;

const usePearlStore = create((set, get) => ({
  ...IDLE_CALL,
  lastError: null, // dispatch failure shown above the form: { status, title, message, needsTopUp }
  dispatchSeq: 0,

  /** Place a call. Resolves true when the server returned a call id for this dispatch. */
  deployPearl: async (payload, meta = null) => {
    if (get().phase === 'dispatching') return false; // double submit
    const seq = get().dispatchSeq + 1;
    set({ ...IDLE_CALL, phase: 'dispatching', callMeta: meta, lastError: null, dispatchSeq: seq });

    let data;
    try {
      data = await apiFetch('/api/pearl/deploy', { method: 'POST', body: payload });
    } catch (err) {
      if (get().dispatchSeq !== seq) return false;
      set({ ...IDLE_CALL, lastError: describeDeployError(err) });
      return false;
    }

    const callId = data && data.call_id ? String(data.call_id) : null;
    if (get().dispatchSeq !== seq) {
      // Cancelled (or reset) while the request was in flight: hang up the call it created.
      if (callId) {
        try {
          await apiFetch(`${callPath(callId)}/cancel`, { method: 'POST' });
        } catch (err) {
          const state = get();
          if (err?.status !== 400 && state.phase === 'cancelled' && !state.activeCallId) {
            set({
              actionError: `The call had already been placed and could not be cancelled (${errorMessage(err, 'unknown error')}). It may still ring.`,
            });
          }
        }
      }
      return false;
    }
    if (!callId) {
      set({
        ...IDLE_CALL,
        lastError: {
          status: 0,
          title: 'Call status unavailable',
          message: 'The server accepted the request but returned no call id, so this call cannot be followed here.',
          needsTopUp: false,
        },
      });
      return false;
    }
    set({ activeCallId: callId, ...statusPatch(normalizeCallStatus(data.status) || 'initiating') });
    return true;
  },

  /** Cancel / hang up the current call (or abandon a dispatch that has no call id yet). */
  cancelCall: async () => {
    const { phase, activeCallId, cancelling } = get();
    if (phase === 'dispatching') {
      set((s) => ({ dispatchSeq: s.dispatchSeq + 1, ...statusPatch('cancelled') }));
      return true;
    }
    if (!activeCallId || isTerminalPhase(phase) || cancelling) return false;
    set({ cancelling: true, actionError: null });
    try {
      await apiFetch(`${callPath(activeCallId)}/cancel`, { method: 'POST' });
      if (get().activeCallId !== activeCallId) return true;
      set((s) => ({ cancelling: false, ...(isTerminalPhase(s.phase) ? {} : statusPatch('cancelled')) }));
      return true;
    } catch (err) {
      if (get().activeCallId !== activeCallId) return false;
      set({ cancelling: false, actionError: errorMessage(err, 'The call could not be cancelled. Try again.') });
      return false;
    }
  },

  /** Apply a socket `call.status` frame or a polled call body to the current call. */
  applyCallStatus: (callId, update) => {
    const state = get();
    if (!callId || state.activeCallId !== callId) return;
    const patch = reduceCallStatus(state, update);
    if (patch) set(patch);
  },

  addTranscriptMessage: (callId, data) => {
    if (!callId || get().activeCallId !== callId) return;
    const entry = normalizeTranscriptEntry(data);
    if (!entry) return;
    const stamped = { ...entry, at: Date.now() };
    set((s) => ({ transcript: [...s.transcript, stamped].slice(-MAX_TRANSCRIPT) }));
  },

  /** Live-update channel of the current call (socket, polling fallback, stopped + reason). */
  setLiveMode: (callId, liveMode, liveError = null) => {
    if (!callId || get().activeCallId !== callId) return;
    set({ liveMode, liveError });
  },

  clearError: () => set({ lastError: null }),

  /** Back to the empty form: forgets the call, its transcript and any error. */
  resetCall: () => set((s) => ({ ...IDLE_CALL, lastError: null, dispatchSeq: s.dispatchSeq + 1 })),
}));

export default usePearlStore;
