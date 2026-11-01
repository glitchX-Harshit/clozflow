# Voice Pipeline Evaluation Guide

## 1. Overview
Evaluating voice agents requires measuring acoustic and timing properties that text-only benchmarks miss. The voice evaluation module benchmarks:
1. Speech Recognition Accuracy (WER/CER).
2. Streaming Latency (TTFT, Total Turn Latency, P95/P99 distributions).
3. Turn Management (Barge-in / Interruption Handling, false interrupt rate).

## 2. Voice Test Scenarios
The `voice_scenarios` category provides 10 synthetic stress patterns:
- Rapid code-switching (Hinglish).
- Mid-sentence customer barge-in ("Wait wait stop, listen to me first!").
- Heavy Indian regional accents and phonetic variants.
- Acoustic traffic noise and low-volume whisper fixtures.
- Awkward conversational pauses and silence detection.

## 3. Latency Benchmarks
```
Target P50:  < 400ms
Target P95:  < 800ms
Target P99:  < 1200ms
```
When running with `--adapter direct`, the adapter streams tokens directly from Groq using HTTP keepalive pooling to measure actual streaming TTFT.
