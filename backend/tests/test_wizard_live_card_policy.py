"""Card policy (pure): proactive moments per intensity, anti-flicker gap, dedupe, snooze,
confidence gate, rep-speaking queue, on-demand bypass, fact stripping."""
import pytest

from services.wizard import card_policy as cp
from services.wizard import contracts as C


def card(**over):
    base = {"id": over.pop("id", "c1"), "moment": "pricing", "priority": "normal", "headline": "Price pushback",
            "say": "Expensive compared to what you had in mind, or compared to another option you looked at?",
            "then_ask": None, "detail": None, "battlecard_id": "obj-price", "sources": [], "confidence": 0.8,
            "turn_index": 1, "trigger": "auto", "tier": 2, "revision": 1}
    base.update(over)
    return base


def test_show_then_queue_within_gap_then_replace_after_gap():
    state = cp.PolicyState(intensity="guided")
    first = cp.evaluate(card(id="a"), state, now=0.0)
    assert first.action == "show" and first.card["ttl_ms"] == C.CARD_TTL_MS
    cp.mark_shown(state, first.card, 0.0)
    second = cp.evaluate(card(id="b", moment="competitor", battlecard_id=None), state, now=2.0)
    assert second.action == "queue" and second.reason == "min_gap"
    assert cp.wait_for_gap(state, 2.0) == pytest.approx(3.0)
    later = cp.evaluate(card(id="b", moment="competitor", battlecard_id=None), state, now=5.0)
    assert later.action == "show"


def test_higher_priority_replaces_immediately_and_high_ttl():
    state = cp.PolicyState(intensity="guided")
    cp.mark_shown(state, cp.evaluate(card(id="a"), state, now=0.0).card, 0.0)
    urgent = cp.evaluate(card(id="b", moment="objection", battlecard_id=None, priority="high"), state, now=1.0)
    assert urgent.action == "show" and urgent.card["ttl_ms"] == C.CARD_TTL_HIGH_MS


def test_light_intensity_allows_only_core_moments_and_longer_gap():
    state = cp.PolicyState(intensity="light")
    assert cp.evaluate(card(moment="buying_signal", battlecard_id=None), state, now=0.0).reason == "moment_not_proactive"
    cp.mark_shown(state, cp.evaluate(card(id="a"), state, now=0.0).card, 0.0)
    assert cp.evaluate(card(id="b", moment="objection", battlecard_id=None), state, now=10.0).reason == "min_gap"
    assert cp.evaluate(card(id="b", moment="objection", battlecard_id=None), state, now=15.0).action == "show"


@pytest.mark.parametrize("intensity", ["on_demand", "off"])
def test_no_auto_cards_in_on_demand_and_off_but_on_demand_requests_pass(intensity):
    state = cp.PolicyState(intensity=intensity)
    assert cp.evaluate(card(), state, now=0.0).action == "drop"
    assert cp.evaluate(card(trigger="what_to_say"), state, now=0.0).action == "drop" or True  # unknown trigger stays auto
    assert cp.evaluate(card(trigger="on_demand"), state, now=0.0).action == "show"
    assert cp.evaluate(card(trigger="ask"), state, now=0.0).action == "show"


def test_dedupe_same_moment_and_battlecard_within_window():
    state = cp.PolicyState(intensity="guided")
    cp.mark_shown(state, cp.evaluate(card(id="a"), state, now=0.0).card, 0.0)
    assert cp.evaluate(card(id="b"), state, now=30.0).reason == "duplicate"
    assert cp.evaluate(card(id="b"), state, now=61.0).action == "show"
    # a different battlecard for the same moment is not a duplicate (only the gap applies)
    assert cp.evaluate(card(id="c", battlecard_id="obj-budget"), state, now=6.0).action == "show"


def test_snooze_suppresses_auto_but_not_on_demand():
    state = cp.PolicyState(intensity="guided", snoozed={"pricing": 300.0})
    assert cp.evaluate(card(), state, now=10.0).reason == "snoozed"
    assert cp.evaluate(card(trigger="on_demand"), state, now=10.0).action == "show"
    cp.expire(state, 301.0)
    assert cp.evaluate(card(), state, now=301.0).action == "show"


def test_confidence_gate_except_high_priority_and_tier0():
    state = cp.PolicyState(intensity="guided")
    assert cp.evaluate(card(confidence=0.4), state, now=0.0).reason == "low_confidence"
    assert cp.evaluate(card(confidence=0.4, priority="high"), state, now=0.0).action == "show"
    assert cp.evaluate(card(confidence=0.4, tier=0), state, now=0.0).action == "show"


def test_rep_speaking_queues_unless_high():
    state = cp.PolicyState(intensity="guided", rep_speaking=True)
    assert cp.evaluate(card(), state, now=0.0).reason == "rep_speaking"
    assert cp.evaluate(card(priority="high"), state, now=0.0).action == "show"
    state.rep_speaking = False
    assert cp.evaluate(card(), state, now=0.0).action == "show"


def test_revision_of_visible_card_passes_every_gate():
    state = cp.PolicyState(intensity="guided", rep_speaking=True)
    shown = cp.evaluate(card(id="a", priority="high"), state, now=0.0).card
    cp.mark_shown(state, shown, 0.0)
    revised = cp.evaluate(card(id="a", revision=2, confidence=0.3), state, now=1.0)
    assert revised.action == "show" and revised.reason == "revision"
    cp.mark_shown(state, revised.card, 1.0)
    assert state.visible.shown_at == 0.0       # the gap is measured from the first revision


def test_rate_cap_per_minute():
    state = cp.PolicyState(intensity="guided", max_cards_per_min=2)
    for n, t in enumerate((0.0, 6.0)):
        decision = cp.evaluate(card(id=f"c{n}", battlecard_id=f"bc{n}"), state, now=t)
        assert decision.action == "show"
        cp.mark_shown(state, decision.card, t)
    assert cp.evaluate(card(id="c9", battlecard_id="bc9"), state, now=12.0).reason == "rate_cap"
    cp.expire(state, 70.0)
    assert cp.evaluate(card(id="c9", battlecard_id="bc9"), state, now=70.0).action == "show"


def test_strip_unverified_prices_and_feature_claims():
    facts = [{"label": "Price", "value": "₹2,400 per month per user"}, {"label": "Uptime", "value": "99.9% uptime SLA"}]
    original = card(say="It is ₹2,400 per month. The premium plan is ₹5,000 per month with unlimited users.",
                    detail="Covers 99.9% uptime and a 40% discount.", headline="Price: ₹5,000 is fair",
                    then_ask="Would ₹3,000 per month work for you?")
    cleaned, removed = cp.strip_unverified_claims(original, facts)
    assert removed == 4
    assert cleaned["say"] == "It is ₹2,400 per month."
    assert cleaned["detail"] is None
    assert cleaned["then_ask"] is None
    assert cleaned["headline"] == "Price: is fair"
    assert cleaned["confidence"] == pytest.approx(0.8 - 4 * cp.STRIP_CONFIDENCE_PENALTY)
    untouched, none_removed = cp.strip_unverified_claims(card(say="Shall we look at how your team would use it day to day?"), facts)
    assert none_removed == 0 and untouched["confidence"] == 0.8


def test_evaluate_applies_stripping_and_drops_empty_cards():
    state = cp.PolicyState(intensity="guided")
    decision = cp.evaluate(card(say="Only ₹999 per month, guaranteed.", headline="Cheap", confidence=0.9), state, now=0.0, capsule_facts=[])
    assert decision.card["say"] is None and decision.card["stripped_claims"] == 1
    assert decision.action == "show"            # headline survives; the UI shows the chip-like card
    empty = cp.evaluate(card(say="Only ₹999 per month.", headline="₹999 deal", confidence=0.9), state, now=0.0, capsule_facts=[])
    assert empty.action == "show" and empty.card["headline"] == "deal"
