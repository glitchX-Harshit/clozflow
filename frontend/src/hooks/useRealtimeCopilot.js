import { useState, useEffect, useCallback, useRef } from 'react';

export const useRealtimeCopilot = (wsUrl = 'ws://localhost:8000/ws') => {
    const [isConnected, setIsConnected] = useState(false);
    const [transcript, setTranscript] = useState([]);
    const [latestObjection, setLatestObjection] = useState(null);
    const [latestSuggestion, setLatestSuggestion] = useState(null);
    const ws = useRef(null);

    useEffect(() => {
        ws.current = new WebSocket(wsUrl);

        ws.current.onopen = () => {
            setIsConnected(true);
            console.log('Connected to hexagon.ai copilot backend');
        };

        ws.current.onclose = () => {
            setIsConnected(false);
            console.log('Disconnected from hexagon.ai copilot backend');
        };

        ws.current.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === 'objectionDetect') {
                    setLatestObjection(data.objection);
                    // clear objection after 8 seconds
                    setTimeout(() => setLatestObjection(null), 8000);
                } else if (data.type === 'aiSuggestion') {
                    setLatestSuggestion(data.suggestion);
                    // clear suggestion after 12 seconds
                    setTimeout(() => setLatestSuggestion(null), 12000);
                } else if (data.type === 'transcriptUpdate') {
                    setTranscript(prev => [...prev, data]);
                }
            } catch (err) {
                console.error('WebSocket message parse error:', err);
            }
        };

        return () => {
            if (ws.current) {
                ws.current.close();
            }
        };
    }, [wsUrl]);

    // Method to simulate speaking (since actual mic recording -> Deepgram is complex for this browser sandbox)
    const simulateSpeech = useCallback((text, speaker = 'prospect') => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            const payload = { type: 'transcriptUpdate', text, speaker };
            ws.current.send(JSON.stringify(payload));
            setTranscript(prev => [...prev, payload]);
        }
    }, []);

    return {
        isConnected,
        transcript,
        latestObjection,
        latestSuggestion,
        simulateSpeech
    };
};
