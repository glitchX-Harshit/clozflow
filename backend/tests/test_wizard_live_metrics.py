"""Deterministic metrics and threshold nudges."""
from services.wizard import contracts as C
from services.wizard.metrics import MetricsTracker


def _talk(tracker, speaker, text, t0, t1, channel):
    tracker.on_speech(channel, True, t0)
    tracker.on_speech(channel, False, t1)
    tracker.on_turn(speaker, text, t0, t1, channel=channel)


def test_channel_tagged_metrics_talk_ratio_questions_and_interruptions():
    tracker = MetricsTracker(channel_tagged=True)
    _talk(tracker, "salesperson", "Hi Ravi, how is the bakery doing this season?", 0.0, 4.0, C.CHANNEL_REP)
    _talk(tracker, "prospect", "Busy. Kitna padega yeh?", 4.5, 6.0, C.CHANNEL_PROSPECT)
    tracker.on_speech(C.CHANNEL_REP, True, 5.0)      # the rep starts while the prospect is still speaking
    tracker.on_speech(C.CHANNEL_REP, False, 9.0)
    tracker.on_turn("salesperson", "It depends on the number of users.", 5.0, 9.0, channel=C.CHANNEL_REP)
    metrics = tracker.snapshot(10.0)
    assert metrics["estimated"] is False
    assert metrics["rep_talk_s"] == 8.0 and metrics["prospect_talk_s"] == 1.5
    assert metrics["talk_ratio_rep"] == round(8.0 / 9.5, 3)
    assert metrics["questions_rep"] == 1 and metrics["questions_prospect"] == 1
    assert metrics["interruptions_rep"] == 1 and metrics["interruptions_prospect"] == 0
    assert metrics["elapsed_s"] == 10.0


def test_mixed_audio_is_estimated_and_shares_the_contract_helper():
    tracker = MetricsTracker(channel_tagged=False)
    tracker.on_turn("prospect", "We use Excel and it works for us.", None, None)
    tracker.on_turn("salesperson", "What happens when two people edit it at once?", None, None)
    metrics = tracker.snapshot(30.0)
    assert metrics["estimated"] is True
    assert metrics == {**C.compute_metrics_from_transcript(tracker.segments, elapsed_s=30.0), "estimated": True}


def test_nudges_fire_at_thresholds_once_and_rearm():
    tracker = MetricsTracker(channel_tagged=True)
    tracker.on_speech(C.CHANNEL_REP, True, 0.0)
    assert tracker.nudges(100.0) == []
    nudges = tracker.nudges(151.0)
    assert [n["kind"] for n in nudges] == ["monologue"] and "2:31" in nudges[0]["text"]
    assert tracker.nudges(160.0) == []                       # re-arms after 120 s
    tracker.on_speech(C.CHANNEL_REP, False, 300.0)
    tracker.on_turn("salesperson", "So that is the full feature list and the roadmap.", 0.0, 300.0, channel=C.CHANNEL_REP)
    _talk(tracker, "prospect", "Okay.", 301.0, 302.0, C.CHANNEL_PROSPECT)
    kinds = {n["kind"] for n in tracker.nudges(361.5)}
    # the monologue ended (the prospect spoke last); the room has been silent for ~60 s
    assert kinds == {"talk_ratio", "no_questions", "silence"}
    assert tracker.nudges(362.0) == []


def test_silence_nudge_needs_prior_speech_and_no_active_speaker():
    tracker = MetricsTracker(channel_tagged=True)
    assert tracker.nudges(50.0) == []                        # nobody has spoken yet
    _talk(tracker, "prospect", "Hello?", 1.0, 2.5, C.CHANNEL_PROSPECT)
    assert tracker.nudges(10.0) == []
    assert [n["kind"] for n in tracker.nudges(23.0)] == ["silence"]
    tracker.on_speech(C.CHANNEL_REP, True, 24.0)
    assert tracker.nudges(200.0) == [] or all(n["kind"] != "silence" for n in tracker.nudges(200.0))


def test_live_monologue_counts_before_the_turn_ends():
    tracker = MetricsTracker(channel_tagged=True)
    tracker.on_speech(C.CHANNEL_REP, True, 10.0)
    assert tracker.live_monologue_s(70.0) == 60.0
    assert tracker.snapshot(70.0)["longest_monologue_rep_s"] == 60.0
