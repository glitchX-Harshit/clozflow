"""Deal record: incremental deltas, objections, buying signals, next step, explainable health."""
from services.wizard import contracts as C
from services.wizard.deal_record import DealRecordTracker


def test_flat_and_nested_deltas_with_confidence_and_evidence():
    deal = DealRecordTracker("bant")
    assert [f["field"] for f in deal.record["fields"]] == ["budget", "authority", "need", "timeline"]
    assert deal.apply_delta({"budget": "around 50 thousand a year", "authority": "unknown", "junk": "x"},
                            turn_index=3, quote="hum 50 thousand saal ka soch rahe the")
    budget = next(f for f in deal.record["fields"] if f["field"] == "budget")
    assert budget["value"] == "around 50 thousand a year" and budget["evidence_quote"].startswith("hum 50")
    assert budget["confidence"] == 0.6 and budget["turn_index"] == 3
    assert next(f for f in deal.record["fields"] if f["field"] == "authority")["value"] is None
    # a lower-confidence different value does not overwrite; a higher one does
    assert not deal.apply_delta({"budget": {"value": "unknown amount", "confidence": 0.3}}, turn_index=4)
    assert deal.apply_delta({"budget": {"value": "50k per year, approved", "confidence": 0.9, "evidence_quote": "approved hai"}}, turn_index=5)
    assert next(f for f in deal.record["fields"] if f["field"] == "budget")["value"] == "50k per year, approved"
    assert deal.version == 2


def test_next_step_stage_risk_and_confirmed_fields():
    deal = DealRecordTracker("meddpicc")
    assert deal.apply_delta({"next_step_text": "Demo with the CFO", "next_step_date": "sometime"}, turn_index=1)
    assert deal.record["next_step"] == {"text": "Demo with the CFO", "date": None}
    assert deal.apply_delta({"next_step": {"text": "Demo with the CFO on 2026-11-20"}}, turn_index=2)
    assert deal.record["next_step"]["date"] == "2026-11-20"
    assert deal.apply_delta({"stage": "Pricing", "risk_text": "Promoter not involved", "risk_severity": "high"}, turn_index=2)
    assert deal.record["stage"] == "pricing" and deal.record["risks"] == [{"text": "Promoter not involved", "severity": "high"}]
    assert not deal.apply_delta({"stage": "weird"}, turn_index=3)
    champion = next(f for f in deal.record["fields"] if f["field"] == "champion")
    champion.update(value="Ravi", confirmed=True, confidence=1.0)
    assert not deal.apply_delta({"champion": "Someone else"}, turn_index=4)


def test_objections_signals_and_health_change_detection():
    deal = DealRecordTracker("meddpicc")
    assert deal.health()["score"] is not None and deal.health_if_changed() is not None
    assert deal.health_if_changed() is None
    assert deal.add_objection({"type": "price", "quote": "bahut mehenga hai"}, turn_index=4, battlecard_id="obj-price")
    assert not deal.add_objection({"type": "price", "quote": "still expensive"}, turn_index=6)      # same open objection
    assert deal.add_objection({"type": "timing", "quote": "after Diwali"}, turn_index=7)
    assert len(deal.open_objections()) == 2
    health_after_objections = deal.health_if_changed()
    assert health_after_objections is not None and "2 objection(s) still open." in health_after_objections["rationale"]
    assert deal.resolve_open_objections(8, how="Explored the budget") and deal.open_objections() == []
    assert deal.add_buying_signal({"quote": "when can we start the rollout?", "why": "asked about rollout"}, turn_index=9)
    assert not deal.add_buying_signal({"quote": "When can we start the rollout?"}, turn_index=10)
    health = deal.health()
    assert health["score"] > health_after_objections["score"]
    assert health["coverage"] == {f: False for f, _ in C.METHODOLOGIES["meddpicc"]}
    assert deal.snapshot() is not deal.record and deal.snapshot() == deal.record


def test_empty_values_are_ignored():
    deal = DealRecordTracker("spin")
    assert not deal.apply_delta({"situation": "", "problem": None, "implication": "n/a", "need_payoff": "unknown"}, turn_index=1)
    assert not deal.add_objection({"type": "", "quote": ""}, turn_index=1) or deal.record["objections"][0]["type"] == "other"
    assert not deal.add_buying_signal({"quote": "   "}, turn_index=1)
