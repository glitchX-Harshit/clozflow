"""Coach engine with a fake LLM and a fake clock: the LIVE_LATENCY_PLAN §6 acceptance list.

Tier 0 instant provisional cards, Tier 2 streamed first sentence (≤ 700 ms with a 500 ms LLM),
cadence (0 / 2 / 4 s → cards at 0 and 5 s), rep-speaking queue swapped at the micro-pause,
late flag, one strip per prospect segment, on-demand bypassing snooze/off, nothing on failure,
fact stripping, escalation chips, deal record / health emission, caps.
"""
import asyncio
import json
import re
import time

import pytest

import test_bridge_kit  # noqa: F401  (test environment: no .env, no keys)
from services.wizard import contracts as C
from services.wizard.coach_engine import CoachSession, classify_segment, detect_escalation


# ── fakes ────────────────────────────────────────────────────────────────────

class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def response(moment="pricing", say=None, **over):
    base = {
        "moment": moment, "priority": over.pop("priority", "normal"), "headline": over.pop("headline", "Price pushback"),
        "say": say or "Expensive compared to what you had budgeted, or compared to another option you looked at? "
                      "Let's first see what the current process costs you every week.",
        "then_ask": "What would make this an easy yes for you?", "detail": "Explore before you defend the number.",
        "say_lang": "en-IN", "battlecard_id": None, "sources": ["brief"], "confidence": 0.82,
        "deal_record_delta": {}, "objection": None, "buying_signal": None,
    }
    base.update(over)
    return base


class FakeLLM:
    name = "fake"
    model = "fake-1"

    def __init__(self, reply=None, *, delay=0.0, split=True, fail=False, raw=None):
        self.reply = reply if reply is not None else response()
        self.delay = delay
        self.split = split
        self.fail = fail
        self.raw = raw
        self.calls = []

    async def warmup(self):
        return None

    async def stream(self, system, user, schema, *, max_tokens=350):
        self.calls.append({"system": system, "user": user, "max_tokens": max_tokens, "schema": schema})
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("boom")
        if self.raw is not None:
            yield self.raw
            return
        reply = self.reply(user) if callable(self.reply) else self.reply
        text = json.dumps(reply)
        if not self.split:
            yield text
            return
        say_at = text.find('"say": "')
        end = re.search(r"[.?!] ", text[say_at:]) if say_at >= 0 else None
        cut = say_at + end.end() if end else len(text) // 2
        yield text[:cut]
        await asyncio.sleep(0.01)
        yield text[cut:]


async def no_retrieval(query):
    return []


def new_turn(user_prompt):
    """The prospect's new turn inside a Tier 2 user prompt (the history also contains earlier turns)."""
    found = re.search(r"NEW PROSPECT TURN: (.*)", user_prompt)
    return found.group(1) if found else ""


def make_session(*, llm=None, clock=None, intensity="guided", wizard=None, **over):
    sent = []

    async def emit(message):
        sent.append(message)
    wizard = wizard or {"methodology": "bant", "capsule_facts": [{"label": "Price", "value": "₹2,400 per month"}],
                        "battlecards": [{"id": "obj-price", "title": "Too expensive", "kind": "objection",
                                         "act": "Expensive compared to your budget, or to another option you looked at? Tell me which and I will show the numbers that matter.",
                                         "question_to_ask": "Compared to what?", "trigger_keywords": ["expensive", "mehenga"]},
                                        {"id": "comp-zoho", "title": "Zoho", "kind": "competitive", "act": "Zoho is solid for ticketing; we are built for field sales teams in India.",
                                         "question_to_ask": "What works with Zoho today?", "trigger_keywords": ["zoho"]}],
                        "pre_rendered_cards": [{"battlecard_id": "obj-price", "headline": "Price pushback", "moment": "pricing",
                                                "say": "Mehenga kis hisaab se, aapke budget se ya kisi aur option se? Pehle dekhte hain abhi ka process har hafte kitna time leta hai.",
                                                "say_lang": "hinglish", "then_ask": "Budget kitna socha tha?",
                                                "trigger_keywords": ["mehenga", "expensive", "too costly"]}]}
    session = CoachSession(call_context={"client_name": "Ravi", "product_name": "ClozFlow", "call_goal": "Book a demo"},
                           wizard=wizard, emit=emit, user_id=1, intensity=intensity, llm=llm, retriever=no_retrieval,
                           clock=clock or time.monotonic, **over)
    return session, sent


def cards(sent):
    return [m["card"] for m in sent if m["type"] == "coach"]


def types(sent):
    return [m["type"] for m in sent]


def run(coro):
    return asyncio.run(coro)


# ── tests ────────────────────────────────────────────────────────────────────

def test_tier0_partial_shows_provisional_card_instantly():
    async def go():
        session, sent = make_session(llm=None)
        started = time.monotonic()
        await session.on_partial("yeh toh bahut mehenga", channel=C.CHANNEL_PROSPECT, turn_index=0)
        return session, sent, (time.monotonic() - started) * 1000

    session, sent, elapsed_ms = run(go())
    assert elapsed_ms < C.SLO_TIER0_MS
    [card] = cards(sent)
    assert card["tier"] == 0 and card["provisional"] is True and card["revision"] == 1
    assert card["moment"] == "pricing" and card["battlecard_id"] == "obj-price"
    assert card["say"].startswith("Mehenga kis hisaab se") and card["say_lang"] == "hinglish"
    assert card["then_ask"] == "Budget kitna socha tha?" and card["latency_ms"] < C.SLO_TIER0_MS
    assert card["sources"][0] == {"kind": "battlecard", "label": "Price pushback", "ref": "obj-price"}
    assert "aiAnalysis" not in types(sent)      # provisional cards don't become legacy suggestions
    assert session.latency_summary()["cards"] == 1


def test_tier2_streams_first_sentence_then_completes_in_place():
    llm = FakeLLM(response(moment="objection", headline="Price objection", priority="high"), delay=0.5)

    async def go():
        session, sent = make_session(llm=llm)
        eot = time.monotonic()
        await session.on_turn("prospect", "That sounds very costly for a small bakery like ours.", channel=C.CHANNEL_PROSPECT,
                              turn_index=0, eot_at=eot, t_start=1.0, t_end=3.5)
        return session, sent

    session, sent = run(go())
    assert types(sent)[0] == "strip"
    first, second = cards(sent)
    assert first["id"] == second["id"] and (first["revision"], second["revision"]) == (1, 2)
    assert first["provisional"] is True and second["provisional"] is False
    assert first["say"].endswith("looked at?") and C.word_count(second["say"]) > C.word_count(first["say"])
    assert 500 <= first["latency_ms"] <= 700 and first["late"] is False
    assert second["cue"] == "pause" and second["then_ask"].endswith("?") and second["tier"] == 2
    assert second["say_words"] == C.word_count(second["say"]) and second["sources"] == [{"kind": "brief", "label": "Call brief", "ref": None}]
    analyses = [m for m in sent if m["type"] == "aiAnalysis"]
    assert len(analyses) == 1 and analyses[0]["payload"]["suggested_response"] == second["say"]
    assert analyses[0]["payload"]["engine"] == "coach" and analyses[0]["latency"]["tier"] == 2
    assert [i["card"]["id"] for i in session.insights.values()] == [second["id"]]
    assert llm.calls[0]["max_tokens"] == 350 and "NEW PROSPECT TURN" in llm.calls[0]["user"]
    assert "FACT TABLE" in llm.calls[0]["system"] and "₹2,400 per month" in llm.calls[0]["system"]
    assert session.cost.summary()["llm_calls"] == 1 and session.latency_summary()["cards"] == 1


def test_cadence_three_triggers_give_two_cards():
    def reply(user):
        text = new_turn(user)
        if "How much" in text:
            return response("pricing", headline="Pricing raised")
        if "Zoho" in text:
            return response("competitor", headline="Competitor: Zoho", battlecard_id="comp-zoho")
        return response("buying_signal", headline="Buying signal", say="Great question. Rollout usually takes two weeks; shall we pencil in a start date and plan backwards from there together?")
    llm = FakeLLM(reply, split=False)
    clock = Clock()

    async def go():
        session, sent = make_session(llm=llm, clock=clock)
        await session.on_turn("prospect", "How much does it cost?", channel=2, turn_index=0, eot_at=clock())
        clock.t += 2.0
        await session.on_turn("prospect", "We already use Zoho for this.", channel=2, turn_index=1, eot_at=clock())
        clock.t += 2.0
        await session.on_turn("prospect", "When can we start the rollout?", channel=2, turn_index=2, eot_at=clock())
        shown_before_gap = len(cards(sent))
        clock.t += 0.5
        await session.tick()
        shown_at_4_5 = len(cards(sent))
        clock.t += 0.5
        await session.tick()
        return sent, shown_before_gap, shown_at_4_5

    sent, before, at_4_5 = run(go())
    assert before == 1 and at_4_5 == 1
    first, second = cards(sent)
    assert first["moment"] == "pricing" and second["moment"] == "buying_signal"
    assert second["latency_ms"] == 1000 and second["late"] is False
    # the competitor card was superseded by the newer queued one: it survives as a chip
    assert {"type": "moment", "moment": "competitor", "entity": "Zoho", "turn_index": 1} in sent


def test_higher_priority_replaces_within_gap():
    llm = FakeLLM(lambda user: response("objection", priority="high") if "expensive" in new_turn(user) else response("pricing"), split=False)
    clock = Clock()

    async def go():
        session, sent = make_session(llm=llm, clock=clock)
        await session.on_turn("prospect", "How much does it cost?", channel=2, turn_index=0, eot_at=clock())
        clock.t += 1.0
        await session.on_turn("prospect", "That is too expensive.", channel=2, turn_index=1, eot_at=clock())
        return sent

    sent = run(go())
    assert [c["moment"] for c in cards(sent)] == ["pricing", "objection"]


def test_rep_speaking_queues_card_until_micro_pause_and_high_interrupts():
    llm = FakeLLM(split=False)
    clock = Clock()

    async def go():
        session, sent = make_session(llm=llm, clock=clock)
        session.on_speech(C.CHANNEL_REP, True)
        await session.on_turn("prospect", "How much does it cost?", channel=2, turn_index=0, eot_at=clock())
        queued = len(cards(sent))
        clock.t += 3.0
        session.on_speech(C.CHANNEL_REP, False)            # the rep pauses
        clock.t += 0.25
        await session.tick()
        still_queued = len(cards(sent))
        clock.t += 0.5                                       # ≥ 600 ms of pause
        await session.tick()
        after_pause = len(cards(sent))
        # a high-priority card while the rep talks again goes straight through
        session.on_speech(C.CHANNEL_REP, True)
        llm.reply = response("objection", priority="high", headline="Objection")
        clock.t += 20.0
        await session.on_turn("prospect", "Honestly it is too expensive for us.", channel=2, turn_index=1, eot_at=clock())
        return sent, queued, still_queued, after_pause

    sent, queued, still_queued, after_pause = run(go())
    assert (queued, still_queued, after_pause) == (0, 0, 1)
    assert cards(sent)[0]["latency_ms"] == 3750
    assert [c["moment"] for c in cards(sent)] == ["pricing", "objection"]


def test_queued_card_goes_stale_and_becomes_a_chip():
    llm = FakeLLM(split=False)
    clock = Clock()

    async def go():
        session, sent = make_session(llm=llm, clock=clock)
        session.on_speech(C.CHANNEL_REP, True)
        await session.on_turn("prospect", "How much does it cost?", channel=2, turn_index=0, eot_at=clock())
        clock.t += C.CARD_STALE_AFTER_S + 1
        await session.tick()
        return sent

    sent = run(go())
    assert cards(sent) == []
    assert [m for m in sent if m["type"] == "moment" and m["moment"] == "pricing"]


def test_late_card_is_flagged():
    clock = Clock()
    llm = FakeLLM(split=False)

    async def go():
        session, sent = make_session(llm=llm, clock=clock)
        await session.on_turn("prospect", "How much does it cost?", channel=2, turn_index=0, eot_at=clock() - 6.0)
        return sent

    sent = run(go())
    [card] = cards(sent)
    assert card["late"] is True and card["latency_ms"] >= 6000


def test_one_strip_per_prospect_segment_and_chips_without_llm():
    async def go():
        session, sent = make_session(llm=None)
        for n, text in enumerate(["How much does it cost per user?", "We already use Zoho for this.",
                                  "Just send me an email with the details.", "Hmm okay."]):
            await session.on_turn("prospect", text, channel=2, turn_index=n, eot_at=time.monotonic())
        await session.on_turn("salesperson", "Sure, I will.", channel=1, turn_index=4, eot_at=time.monotonic())
        return session, sent

    session, sent = run(go())
    strips = [m for m in sent if m["type"] == "strip"]
    assert [s["turn_index"] for s in strips] == [0, 1, 2, 3]
    assert [s["intent"] for s in strips] == ["pricing_question", "competitor_mention", "brush_off", "small_talk"]
    assert strips[0]["label"] == "Pricing question" and strips[0]["ask_next"].endswith("?") and strips[0]["stage"] == "pricing"
    assert strips[1]["ask_next"] == "What works with Zoho today?"      # the matching battlecard's question
    assert all(s["latency_ms"] < C.SLO_TIER1_MS for s in strips)
    chips = [(m["moment"], m["entity"]) for m in sent if m["type"] == "moment"]
    assert chips == [("pricing", None), ("competitor", "Zoho"), ("stall", "brush_off")]
    assert cards(sent) == []
    records = [m for m in sent if m["type"] == "deal_record"]
    assert records and records[-1]["record"]["objections"][0]["type"] == "brush_off"
    assert any(m["type"] == "deal_health" for m in sent)
    assert session.deal.record["stage"] == "objection"


def test_on_demand_bypasses_snooze_and_off_and_reports_missing_llm():
    llm = FakeLLM(split=False)

    async def go():
        session, sent = make_session(llm=llm, intensity="off")
        session.snooze("pricing", 600_000)
        await session.on_turn("prospect", "How much does it cost?", channel=2, turn_index=0, eot_at=time.monotonic())
        assert cards(sent) == [] and "strip" not in types(sent)
        await session.what_to_say()
        await session.ask("How do I handle the price question?")
        nolm, sent2 = make_session(llm=None)
        await nolm.what_to_say()
        return sent, sent2, llm

    sent, sent2, llm = run(go())
    first, second = cards(sent)
    assert (first["trigger"], second["trigger"]) == ("on_demand", "ask")
    assert "MODE: what_to_say" in llm.calls[0]["user"] and "How do I handle the price question?" in llm.calls[1]["user"]
    assert sent2 == [{"type": "notice", "code": "coach_unavailable",
                      "text": "No coaching model is configured on this server (GEMINI_API_KEY or GROQ_API_KEY)."}]


@pytest.mark.parametrize("llm", [FakeLLM(fail=True), FakeLLM(raw="not json at all"), FakeLLM(raw='{"moment": "pricing", "say": "short"}'),
                                 FakeLLM(response("none"), split=False)])
def test_failures_and_none_emit_no_card(llm):
    async def go():
        session, sent = make_session(llm=llm)
        await session.on_turn("prospect", "How much does it cost?", channel=2, turn_index=0, eot_at=time.monotonic())
        return sent

    sent = run(go())
    assert cards(sent) == [] and "aiAnalysis" not in types(sent) and "notice" not in types(sent)


def test_unverified_prices_are_stripped_from_cards():
    llm = FakeLLM(response(say="It is ₹2,400 per month for your team. The enterprise plan is ₹9,000 per month with unlimited users. Shall we look at what your team needs first?"), split=False)

    async def go():
        session, sent = make_session(llm=llm)
        await session.on_turn("prospect", "How much does it cost?", channel=2, turn_index=0, eot_at=time.monotonic())
        return sent

    sent = run(go())
    [card] = cards(sent)
    assert card["say"] == "It is ₹2,400 per month for your team. Shall we look at what your team needs first?"
    assert card["stripped_claims"] == 1 and card["confidence"] == pytest.approx(0.82 - 0.15)


def test_escalation_after_objection_emits_stall_chip():
    assert detect_escalation("I can do a 20% discount if you sign today") == "escalation"
    assert detect_escalation("Let me understand your budget first") is None

    async def go():
        session, sent = make_session(llm=None)
        await session.on_turn("prospect", "Honestly this is too expensive for us.", channel=2, turn_index=0, eot_at=time.monotonic())
        await session.on_turn("salesperson", "I can give you a special price if you decide today, last chance.", channel=1, turn_index=1, eot_at=time.monotonic())
        return sent

    sent = run(go())
    assert {"type": "moment", "moment": "stall", "entity": "escalation", "turn_index": 1} in sent


def test_deal_record_delta_objection_and_health_are_emitted():
    llm = FakeLLM(response("objection", priority="high", deal_record_delta={"budget": "about 50k a year", "next_step_text": "Demo", "next_step_date": "2026-11-20"},
                           objection={"type": "price", "quote": "too expensive"}), split=False)

    async def go():
        session, sent = make_session(llm=llm)
        await session.on_turn("prospect", "Too expensive, we have about 50k a year.", channel=2, turn_index=0, eot_at=time.monotonic())
        session.feedback(cards(sent)[-1]["id"], "used")
        return session, sent

    session, sent = run(go())
    record = [m for m in sent if m["type"] == "deal_record"][-1]["record"]
    budget = next(f for f in record["fields"] if f["field"] == "budget")
    assert budget["value"] == "about 50k a year" and budget["evidence_quote"].startswith("Too expensive")
    assert record["next_step"] == {"text": "Demo", "date": "2026-11-20"}
    health = [m for m in sent if m["type"] == "deal_health"][-1]
    assert health["score"] is not None and "A dated next step is agreed." in health["rationale"]
    assert session.deal.open_objections() == []            # "used" feedback resolves the objection
    assert list(session.insights.values())[0]["feedback"] == "used"


def test_turn_resumed_cancels_speculative_generation():
    llm = FakeLLM(delay=0.3, split=False)

    async def go():
        session, sent = make_session(llm=llm)
        await session.on_eager_eot("How much does it", channel=2, turn_index=0)
        assert session._inflight is not None
        session.on_turn_resumed(channel=2)
        await asyncio.sleep(0.4)
        return sent

    sent = run(go())
    assert cards(sent) == []


def test_eager_eot_result_is_reused_for_the_final_turn():
    llm = FakeLLM(delay=0.2, split=False)

    async def go():
        session, sent = make_session(llm=llm)
        await session.on_eager_eot("How much does it cost", channel=2, turn_index=0)
        await asyncio.sleep(0.05)
        await session.on_turn("prospect", "How much does it cost?", channel=2, turn_index=0, eot_at=time.monotonic())
        return sent, llm

    sent, llm = run(go())
    assert len(cards(sent)) == 1 and len(llm.calls) == 1


def test_session_cap_and_rate_cap_degrade_with_notice():
    clock = Clock()
    replies = {"0": response("pricing"), "1": response("competitor", battlecard_id="comp-zoho", headline="Competitor"),
               "2": response("buying_signal", headline="Buying signal")}
    llm = FakeLLM(lambda user: replies[re.search(r"NEW PROSPECT TURN: This is turn (\d)", user).group(1)], split=False)

    async def go():
        session, sent = make_session(llm=llm, clock=clock)
        session.session_max_minutes = 1
        session.policy.max_cards_per_min = 1
        for n in range(3):
            clock.t += 6.0
            await session.on_turn("prospect", f"This is turn {n}, how much does it cost?", channel=2, turn_index=n, eot_at=clock())
        notices = [m for m in sent if m["type"] == "notice"]
        clock.t += 61.0
        await session.tick()
        return session, sent, notices

    session, sent, notices = run(go())
    assert notices and notices[0]["code"] == "degraded" and notices[0]["intensity"] == "light"
    assert [m for m in sent if m["type"] == "notice"][-1]["intensity"] == "on_demand"
    assert session.intensity == "on_demand"


def test_classify_segment_hinglish_and_objection_types():
    assert classify_segment("Yeh bahut mehenga hai humare liye")["intent"] == "objection_price"
    timing = classify_segment("Abhi nahi, Diwali ke baad dekhte hain")
    assert timing["intent"] in ("objection_timing", "brush_off") and timing["ask_next"].endswith("?")
    assert classify_segment("I need to check with my boss first")["objection_type"] == "authority"
    assert classify_segment("Is this GDPR compliant and where is the data stored?")["intent"] == "objection_security"
    assert classify_segment("Kya aap log Tally ke saath integrate karte ho?")["intent"] == "objection_integration"
    assert classify_segment("namaste")["intent"] == "small_talk"
    direct = classify_segment("Why would your tool be better for us?")
    assert direct["intent"] == "direct_question" and direct["moment"] == "question"
