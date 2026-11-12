import { useCallback, useEffect, useState } from 'react';
import { createAudioStreamController } from './audioStreamController.js';
import { getAuthToken } from '../lib/apiFetch.js';

/**
 * React wrapper around the audio stream controller.
 *
 * - `startRecording(callbacks, { consent })` resolves `{ ok: true }` or
 *   `{ ok: false, reason }` (`picker_cancelled` | `permission_denied` | `no_audio` |
 *   `mic_denied` | `mic_unavailable` | `mic_busy` | `socket_rejected` |
 *   `socket_timeout` | `audio_unavailable` | `unsupported` | `capture_failed` | `busy`);
 *   on failure every captured track is already stopped.
 * - `stopRecording({ finalize })`: `false` = pause (no `close_stream`), `true` = end of call.
 * - `isRecording` / `connectionState` are real state, so the page re-renders when
 *   the share ends or the connection drops.
 * - `protocol`: `{ protocol: 2, channels, meetingId, intensity }` turns on the v2
 *   handshake (hello/ready, tagged channels); omit it for the legacy flow.
 *
 * callbacks: onTranscript, onAiAnalysis, onCoach, onStrip, onMoment, onMetrics,
 *            onDealHealth, onDealRecord, onNotice, onReady, onProtocol, onPong,
 *            onLevel(rms, channel), onEnded(reason), onConnectionChange(state, reason),
 *            onServerError, onSessionSaved.
 */
export const useAudioStream = (wsUrl, { probe, finalizeUrl, protocol } = {}) => {
    const [controller] = useState(() => createAudioStreamController());
    const [isRecording, setIsRecording] = useState(false);
    const [connectionState, setConnectionState] = useState('idle');
    const [connectionReason, setConnectionReason] = useState(null);

    const protocolVersion = protocol?.protocol ?? 1;
    const channelsKey = Array.isArray(protocol?.channels) ? protocol.channels.join(',') : '';
    const meetingId = protocol?.meetingId ?? null;
    const intensity = protocol?.intensity ?? 'guided';

    useEffect(() => {
        controller.configure({
            url: wsUrl,
            // Text socket used to end a paused call (`end_session`).
            finalizeUrl: finalizeUrl || '',
            // The token is read on every (re)connect, so a refreshed session is picked up.
            getProtocols: () => {
                const token = getAuthToken();
                return token ? ['clozflow', `clozflow-auth.${token}`] : ['clozflow'];
            },
            probe,
            protocol: protocolVersion,
            channels: channelsKey ? channelsKey.split(',') : null,
            meetingId,
            intensity,
        });
    }, [controller, wsUrl, finalizeUrl, probe, protocolVersion, channelsKey, meetingId, intensity]);

    // Leaving the page ends the call (sends close_stream when a socket is open).
    useEffect(() => () => controller.stop({ finalize: true }), [controller]);

    const startRecording = useCallback(async (callbacks = {}, options = {}) => {
        const result = await controller.start({
            ...callbacks,
            onConnectionChange: (state, reason) => {
                setConnectionState(state);
                setConnectionReason(reason ?? null);
                callbacks.onConnectionChange?.(state, reason);
            },
            onEnded: (reason) => {
                setIsRecording(false);
                callbacks.onEnded?.(reason);
            },
        }, options);
        setIsRecording(controller.isRecording());
        return result;
    }, [controller]);

    const stopRecording = useCallback(({ finalize = false } = {}) => {
        controller.stop({ finalize });
        setIsRecording(false);
    }, [controller]);

    /** End Call: resolves `{ callId, meetingId? }` once the server saved the call (≤ waitMs). */
    const endCall = useCallback(async (options) => {
        const result = await controller.endCall(options);
        setIsRecording(false);
        return result;
    }, [controller]);

    const retryConnection = useCallback(() => controller.retry(), [controller]);

    return {
        controller,
        startRecording,
        stopRecording,
        endCall,
        retryConnection,
        isRecording,
        connectionState,
        connectionReason,
    };
};
