"""Deterministic conversation metrics from channel-tagged speech, with threshold nudges.

Inputs are the VAD transitions per channel (``on_speech``) and the finished turns
(``on_turn``) with their session-relative times. The numbers come from
``contracts.compute_metrics_from_transcript`` (so the debrief computes the same
values from the stored transcript) plus what only live VAD knows: interruptions
(speech starting while the other channel is active) and a monologue still in
progress. Nudges fire only at thresholds and re-arm after ``NUDGE_REARM_S``:

* monologue > 150 s (rep),
* talk ratio > 70 % after 5 min,
* no rep question for 6 min,
* silence > 20 s.

Mixed (v1) audio can only infer speakers, so its metrics carry ``estimated: true``.
"""
from __future__ import annotations

from typing import Optional

from services.wizard import contracts as C

SPEAKER_FOR_CHANNEL = {C.CHANNEL_REP: "salesperson", C.CHANNEL_PROSPECT: "prospect"}

MONOLOGUE_S = 150.0
TALK_RATIO_MAX = 0.70
TALK_RATIO_AFTER_S = 300.0
NO_QUESTION_S = 360.0
SILENCE_S = 20.0
NUDGE_REARM_S = 120.0
MIN_SPEECH_FOR_SILENCE_S = 1.0     # don't nudge "silence" before anyone has spoken


class MetricsTracker:
    def __init__(self, *, channel_tagged: bool):
        self.channel_tagged = bool(channel_tagged)
        self.segments: list[dict] = []
        self._speaking: dict[int, Optional[float]] = {}
        self._interruptions = {"salesperson": 0, "prospect": 0}
        self._last_speech_t: Optional[float] = None
        self._last_rep_question_t: Optional[float] = None
        self._first_speech_t: Optional[float] = None
        self._nudged: dict[str, float] = {}
        self.nudge_history: list[dict] = []

    # ── inputs ──

    def on_speech(self, channel: int, speaking: bool, t: float) -> None:
        """VAD transition on ``channel`` at session time ``t`` (seconds)."""
        t = float(t)
        if speaking:
            others_active = [c for c, start in self._speaking.items() if start is not None and c != channel]
            if others_active and channel in SPEAKER_FOR_CHANNEL:
                self._interruptions[SPEAKER_FOR_CHANNEL[channel]] += 1
            self._speaking[channel] = t
            if self._first_speech_t is None:
                self._first_speech_t = t
        else:
            self._speaking[channel] = None
        self._last_speech_t = max(self._last_speech_t or 0.0, t)

    def on_turn(self, speaker: str, text: str, t_start: Optional[float], t_end: Optional[float], channel: int = 0) -> None:
        speaker = {"rep": "salesperson", "buyer": "prospect"}.get(speaker, speaker)
        if speaker not in ("salesperson", "prospect"):
            return
        segment = {"speaker": speaker, "text": text or "", "t_start": t_start, "t_end": t_end, "channel": channel}
        self.segments.append(segment)
        end = t_end if t_end is not None else t_start
        if end is not None:
            self._last_speech_t = max(self._last_speech_t or 0.0, float(end))
            if self._first_speech_t is None:
                self._first_speech_t = float(t_start if t_start is not None else end)
        if speaker == "salesperson" and C.is_question(text or ""):
            self._last_rep_question_t = float(end if end is not None else (self._last_speech_t or 0.0))

    # ── outputs ──

    def live_monologue_s(self, now_t: float, channel: int = C.CHANNEL_REP) -> float:
        start = self._speaking.get(channel)
        return max(0.0, float(now_t) - start) if start is not None else 0.0

    def snapshot(self, now_t: float) -> C.Metrics:
        metrics = C.compute_metrics_from_transcript(self.segments, elapsed_s=float(now_t))
        if self.channel_tagged:
            # VAD saw the overlaps; the transcript-based count only sees timestamp overlaps.
            metrics["interruptions_rep"] = max(metrics.get("interruptions_rep", 0), self._interruptions["salesperson"])
            metrics["interruptions_prospect"] = max(metrics.get("interruptions_prospect", 0), self._interruptions["prospect"])
        else:
            metrics["estimated"] = True
        live = self.live_monologue_s(now_t)
        if live > metrics.get("longest_monologue_rep_s", 0.0):
            metrics["longest_monologue_rep_s"] = round(live, 1)
        return metrics

    def nudges(self, now_t: float) -> list[C.Nudge]:
        """Threshold nudges due now (each kind at most once per ``NUDGE_REARM_S``)."""
        now_t = float(now_t)
        metrics = self.snapshot(now_t)
        due: list[C.Nudge] = []

        def fire(kind: str, text: str) -> None:
            last = self._nudged.get(kind)
            if last is not None and now_t - last < NUDGE_REARM_S:
                return
            self._nudged[kind] = now_t
            nudge = C.Nudge(kind=kind, text=text)
            due.append(nudge)
            self.nudge_history.append({**nudge, "t": round(now_t, 1)})

        monologue = max(metrics.get("longest_monologue_rep_s", 0.0), self.live_monologue_s(now_t))
        if self.live_monologue_s(now_t) > MONOLOGUE_S or (
                self.segments and self.segments[-1]["speaker"] == "salesperson" and monologue > MONOLOGUE_S
                and self._last_speech_t is not None and now_t - self._last_speech_t < NUDGE_REARM_S):
            fire("monologue", f"You've been talking for {int(monologue // 60)}:{int(monologue % 60):02d}. Hand it back with a question.")
        ratio = metrics.get("talk_ratio_rep")
        if now_t > TALK_RATIO_AFTER_S and ratio is not None and ratio > TALK_RATIO_MAX:
            fire("talk_ratio", f"You're talking {int(round(ratio * 100))}% of the time. Ask, then listen.")
        if now_t > NO_QUESTION_S and any(s["speaker"] == "salesperson" for s in self.segments):
            last_q = self._last_rep_question_t
            if last_q is None or now_t - last_q > NO_QUESTION_S:
                fire("no_questions", "No question from you in 6 minutes. Ask one open question.")
        if (self._last_speech_t is not None and self._first_speech_t is not None
                and now_t - self._last_speech_t > SILENCE_S
                and self._last_speech_t - self._first_speech_t >= MIN_SPEECH_FOR_SILENCE_S
                and not any(start is not None for start in self._speaking.values())):
            fire("silence", "20 seconds of silence. Check in or summarise what you heard.")
        return due
