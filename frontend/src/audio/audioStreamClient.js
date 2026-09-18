import { useRef, useCallback, useEffect } from 'react';
import { floatTo16BitPCM } from './audioEncoder';

export const useAudioStream = (wsUrl) => {
    const wsRef = useRef(null);
    const audioContextRef = useRef(null);
    const mediaStreamRef = useRef(null);
    const scriptProcessorRef = useRef(null);
    const isRecordingRef = useRef(false);

    // Callbacks for UI updates
    const onTranscriptRef = useRef(null);
    const onAiAnalysisRef = useRef(null);

    const connectWebSocket = useCallback(() => {
        return new Promise((resolve, reject) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                return resolve();
            }

            wsRef.current = new WebSocket(wsUrl);

            wsRef.current.onopen = () => {
                console.log('✅ Audio WebSocket Connected');
                resolve();
            };

            wsRef.current.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.type === 'transcriptUpdate' && onTranscriptRef.current) {
                        onTranscriptRef.current(data);
                    } else if (data.type === 'aiAnalysis' && onAiAnalysisRef.current) {
                        onAiAnalysisRef.current(data.payload);
                        // Log latency breakdown if available
                        if (data.latency) {
                            const l = data.latency;
                            console.log(
                                `📊 Pipeline Latency [Turn #${l.turn_number}]: ` +
                                `STT=${l.stt_ms}ms | TurnDetect=${l.turn_detect_ms}ms | ` +
                                `AI=${l.ai_ms}ms | Total=${l.total_ms}ms (+256ms audio buffer)`
                            );
                        }
                    }
                } catch (err) {
                    console.error('WebSocket Error:', err);
                }
            };

            wsRef.current.onerror = (err) => {
                console.error('WebSocket connection error:', err);
                reject(err);
            };

            wsRef.current.onclose = () => {
                console.log('Audio WebSocket Disconnected');
                if (isRecordingRef.current) {
                    setTimeout(() => connectWebSocket().catch(console.error), 1000); // Reconnect if abruptly dropped while recording
                }
            };
        });
    }, [wsUrl]);

    useEffect(() => {
        return () => {
            stopRecording();
            if (wsRef.current) wsRef.current.close();
        };
    }, []);

    const startRecording = useCallback(async (callbacks = {}) => {
        onTranscriptRef.current = callbacks.onTranscript;
        onAiAnalysisRef.current = callbacks.onAiAnalysis;

        try {
            // ── STEP 1: Open tab picker FIRST ──────────────────────────────────────
            // ⚠️ video:true is REQUIRED for Chrome to show the full tab picker
            // (with the "Chrome Tab" option + "Share tab audio" checkbox).
            // We immediately stop the video track — we only need audio.
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: {
                    echoCancellation: false,   // Meeting app already handles this
                    noiseSuppression: false,   // Preserve full audio fidelity
                    autoGainControl: false     // Avoid double-processing
                }
            });

            // Discard video track immediately (not needed)
            stream.getVideoTracks().forEach(t => t.stop());

            // Guard: user may have not ticked "Share tab audio"
            if (!stream.getAudioTracks().length) {
                console.error('No audio track — user did not enable Share tab audio.');
                alert('No audio detected. Please select a Chrome tab and enable "Share tab audio".');
                return false;
            }

            mediaStreamRef.current = stream;

            // ── STEP 2: Connect WebSocket AFTER stream is ready ────────────────────
            // (Connecting before picker means WS can timeout while user picks a tab)
            await connectWebSocket();

            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioContextRef.current = new AudioContext({ sampleRate: 16000 });

            const source = audioContextRef.current.createMediaStreamSource(stream);

            // Using 1024 buffer size (~64ms of 16kHz audio per chunk) — optimized for low-latency live transcription
            scriptProcessorRef.current = audioContextRef.current.createScriptProcessor(1024, 1, 1);

            scriptProcessorRef.current.onaudioprocess = (e) => {
                if (!isRecordingRef.current) return;

                // [DEBUG LOG]
                console.log("🎧 tab audio frame captured");

                if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
                    console.log("⚠️ WebSocket dropped or not open yet");
                    return;
                }

                const audioData = e.inputBuffer.getChannelData(0);
                const pcm16 = floatTo16BitPCM(audioData);

                // Send raw binary PCM directly for zero-overhead Gemini streaming
                wsRef.current.send(pcm16);
                console.log("📤 audio chunk sent:", pcm16.byteLength);
            };

            // Stop recording automatically if user ends tab share via browser UI
            stream.getAudioTracks()[0].addEventListener('ended', () => {
                console.log('🛑 Tab audio share ended by user');
                stopRecording();
            });

            console.log("🔗 Connecting AudioGraph Nodes...");
            source.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(audioContextRef.current.destination);
            console.log("✅ AudioGraph successfully routed");

            isRecordingRef.current = true;
            return true;
        } catch (err) {
            console.error('Error starting tab audio capture:', err);
            return false;
        }

    }, [connectWebSocket]);

    const stopRecording = useCallback(() => {
        isRecordingRef.current = false;

        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(t => t.stop());
            mediaStreamRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // Signal Gemini end of stream
            wsRef.current.send(JSON.stringify({ type: 'close_stream' }));
        }
    }, []);

    return {
        startRecording,
        stopRecording,
        isRecording: isRecordingRef.current
    };
};
