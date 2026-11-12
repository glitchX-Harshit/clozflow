import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    FALLBACK_NOTICE,
    cardFromSuggestion,
    describeMetrics,
    formatDuration,
    formatSpeaker,
    isFallbackAnalysis,
    mapAnalysis,
    mapCoachCard,
    mapDealHealth,
    mapDealRecord,
    mapMetrics,
    mapMoment,
    mapNudges,
    mapStrip,
    nextDealHealth,
    readDealSignal,
    updateDealHealth,
} from '../src/lib/copilotAnalysis.js';

const legacySuccess = {
    intent: 'pricing',
    strategy: 'REFRAME',
    confidence: 0.82,
    response: 'Compared to what you spend on churn today?',
    suggested_response: 'Compared to what you spend on churn today?',
    next_question: 'What does a lost customer cost you?',
    next_best_question: 'What does a lost customer cost you?',
    coaching_tip: 'Anchor on the cost of inaction.',
    hidden_concern: 'uncertain_roi',
    conversation_goal: 'reframe',
    response_type: 'reframe',
    reasoning_chain: {
        what_are_they_protecting: 'budget',
        what_are_they_worried_about: 'pricing',
        what_information_am_i_missing: 'Inferred from conversation',
        should_i_diagnose_first: false,
    },
    quality_scores: { diagnosis: 0.8, curiosity: 0.7, human_sound: 0.8, persuasion: 0.5, brevity: 0.8 },
    objection_type: 'pricing',
};

const legacyFallback = {
    intent: 'unknown',
    strategy: 'UNKNOWN',
    confidence: 0,
    response: 'ClozFlow daily API limit exceeded. Please review your usage quota to restore real-time AI capabilities.',
    suggested_response: 'ClozFlow daily API limit exceeded. Please review your usage quota to restore real-time AI capabilities.',
    coaching_tip: 'Quota limit exceeded.',
    hidden_concern: 'unknown',
    conversation_goal: 'unknown',
    response_type: 'unknown',
};

const brainComplete = {
    brain_status: 'complete',
    brain_session_id: 's1',
    brain_recommendation_id: 'r1',
    confidence: 0.91,
    suggested_response: 'Most teams in your spot start with the pilot.',
    response: 'Most teams in your spot start with the pilot.',
    coaching_tip: 'They asked for proof; the pilot lowers risk.',
    strategy_used: 'Lower the risk',
    next_best_question: '',
    deal_stage: 'evaluation',
    objection_type: 'none',
    alternatives: ['Would a two-week pilot help?', { body: 'We can start with one team.' }, 7],
};

const brainStatus = (status, message) => ({
    brain_status: status,
    brain_session_id: 's1',
    suggested_response: '',
    response: '',
    next_best_question: '',
    coaching_tip: message,
    confidence: 0,
});

test('legacy success becomes a suggestion with its reasoning chain', () => {
    const { suggestion, notice, objection } = mapAnalysis(legacySuccess, { id: 'x', timestamp: '10:00' });
    assert.equal(notice, null);
    assert.equal(suggestion.id, 'x');
    assert.equal(suggestion.text, legacySuccess.suggested_response);
    assert.equal(suggestion.rationale, 'Anchor on the cost of inaction.');
    assert.equal(suggestion.headline, null, 'legacy has no headline (no duplicated tip)');
    assert.equal(suggestion.nextQuestion, 'What does a lost customer cost you?');
    assert.equal(suggestion.hiddenConcern, 'uncertain_roi');
    assert.deepEqual(suggestion.reasoningChain, {
        protecting: 'budget',
        worried: 'pricing',
        missing: 'Inferred from conversation',
        diagnoseFirst: false,
    });
    assert.equal('qualityScores' in suggestion, false, 'constant quality scores are not shown');
    assert.deepEqual(objection, { type: 'pricing' });
});

test('the legacy quota fallback is a notice, never a line to say', () => {
    assert.equal(isFallbackAnalysis(legacyFallback), true);
    const { suggestion, notice } = mapAnalysis(legacyFallback);
    assert.equal(suggestion, null);
    assert.equal(notice.status, 'fallback');
    assert.equal(notice.message, FALLBACK_NOTICE);

    const flagged = mapAnalysis({ ...legacySuccess, is_fallback: true, error_code: 'llm_timeout' });
    assert.equal(flagged.suggestion, null);
    assert.equal(flagged.notice.code, 'llm_timeout');
});

test('Brain complete exposes headline, rationale, alternatives and confidence', () => {
    const { suggestion, notice, objection } = mapAnalysis(brainComplete);
    assert.equal(notice, null);
    assert.equal(objection, null, '"none" is not an objection');
    assert.equal(suggestion.headline, 'Lower the risk');
    assert.equal(suggestion.rationale, 'They asked for proof; the pilot lowers risk.');
    assert.equal(suggestion.nextQuestion, null);
    assert.deepEqual(suggestion.alternatives, ['Would a two-week pilot help?', 'We can start with one team.']);
    assert.equal(suggestion.confidence, 0.91);
    assert.equal(suggestion.recommendationId, 'r1');
    assert.equal(suggestion.reasoningChain, null, 'no reasoning toggle without a chain');
});

test('Brain withheld / unavailable turns produce a notice and no suggestion', () => {
    const withheld = mapAnalysis(brainStatus('withheld', 'Brain withheld a suggestion because it did not pass its checks.'));
    assert.equal(withheld.suggestion, null);
    assert.equal(withheld.notice.status, 'withheld');
    assert.match(withheld.notice.message, /withheld/);

    const unavailable = mapAnalysis(brainStatus('unavailable', 'Brain unavailable. Transcript retained.'));
    assert.equal(unavailable.notice.status, 'unavailable');
    assert.equal(unavailable.notice.message, 'Brain unavailable. Transcript retained.');
});

test('recorded / duplicate turns change nothing', () => {
    assert.deepEqual(mapAnalysis(brainStatus('recorded', 'Rep transcript recorded as context.')), {
        suggestion: null, notice: null, objection: null, dealScore: null, dealSignal: null,
    });
    assert.equal(mapAnalysis(brainStatus('duplicate', 'Transcript already processed.')).notice, null);
});

test('deal_signal is the Brain 0–100 integer; absent stays null ("--")', () => {
    assert.equal(mapAnalysis(legacySuccess).dealScore, null, 'legacy engine sends no deal_signal');
    assert.equal(mapAnalysis({ ...brainComplete, deal_signal: 72 }).dealScore, 72);
    assert.equal(mapAnalysis({ ...brainComplete, deal_signal: 0 }).dealScore, 0);
    assert.equal(mapAnalysis(brainStatus('withheld', 'x')).dealScore, null);
    assert.deepEqual(readDealSignal(64.6), { dealScore: 65, dealSignal: null });
    assert.deepEqual(readDealSignal('81'), { dealScore: 81, dealSignal: null });
    assert.deepEqual(readDealSignal(140), { dealScore: null, dealSignal: null });
    assert.deepEqual(readDealSignal(-3), { dealScore: null, dealSignal: null });
    assert.deepEqual(readDealSignal(null), { dealScore: null, dealSignal: null });
    // Older servers sent strings.
    assert.deepEqual(readDealSignal('positive'), { dealScore: null, dealSignal: 'positive' });
});

test('deal health: integers replace, legacy strings nudge, nothing keeps "--"', () => {
    assert.equal(updateDealHealth(null, {}), null);
    assert.equal(updateDealHealth(null, { dealScore: 72 }), 72);
    assert.equal(updateDealHealth(72, { dealScore: 40 }), 40);
    assert.equal(updateDealHealth(72, { dealScore: null, dealSignal: null }), 72);
    assert.equal(updateDealHealth(null, { dealSignal: 'positive' }), 56);
    assert.equal(nextDealHealth(56, 'negative'), 51);
});

test('formatDuration uses m:ss (and h:mm:ss past an hour)', () => {
    assert.equal(formatDuration(75), '1:15');
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(3725), '1:02:05');
    assert.equal(formatDuration(undefined), '0:00');
});

/* ── Protocol v2 (coach engine) ─────────────────────────────────────────── */

const coachFrame = {
    type: 'coach',
    card: {
        id: 'card-7',
        moment: 'pricing',
        priority: 'high',
        headline: 'Price pushback',
        say: 'Fair point. Most bakeries recover the fee within the first month from fewer stock-outs. Shall I show the maths for your six outlets?',
        then_ask: 'Kitne outlets se shuru karna chahenge?',
        detail: 'Reframes cost as recovered working capital.',
        cue: 'pause',
        say_lang: 'hinglish',
        say_words: 24,
        battlecard_id: 'obj-price-expensive',
        sources: [{ kind: 'capsule', label: 'Price list v3' }, 'Knowledge: ROI note', { bogus: true }, { kind: 'brief', label: 'Brief' }, { kind: 'x', label: 'Fourth' }],
        confidence: 0.82,
        ttl_ms: 15000,
        turn_index: 12,
        trigger: 'auto',
        tier: 2,
        provisional: false,
        revision: 2,
        late: false,
        latency_ms: 940,
        created_at: '2026-11-12T10:00:00Z',
        objection: { type: 'pricing', quote: 'Bahut mehenga hai' },
    },
};

test('mapCoachCard keeps say as the hero text, then_ask, cue and at most three source chips', () => {
    const card = mapCoachCard(coachFrame);
    assert.equal(card.id, 'card-7');
    assert.equal(card.moment, 'pricing');
    assert.equal(card.priority, 'high');
    assert.equal(card.headline, 'Price pushback');
    assert.match(card.say, /six outlets/);
    assert.equal(card.thenAsk, 'Kitne outlets se shuru karna chahenge?');
    assert.equal(card.cue, 'pause');
    assert.equal(card.sayLang, 'hinglish');
    assert.equal(card.battlecardId, 'obj-price-expensive');
    assert.deepEqual(card.sources.map((s) => s.label), ['Price list v3', 'Knowledge: ROI note', 'Brief']);
    assert.equal(card.ttlMs, 15000);
    assert.equal(card.tier, 2);
    assert.equal(card.revision, 2);
    assert.equal(card.provisional, false);
    assert.equal(card.late, false);
    assert.equal(card.latencyMs, 940);
    assert.equal(card.entity, 'pricing');
    assert.equal(card.objectionQuote, 'Bahut mehenga hai');
});

test('mapCoachCard tolerates partial / malformed frames', () => {
    assert.equal(mapCoachCard(null), null);
    assert.equal(mapCoachCard({ card: { id: 'x', moment: 'pricing' } }), null, 'no headline and no say');
    const headlineOnly = mapCoachCard({ id: 'r1', moment: 'objection', headline: 'one two three four five six seven eight nine ten', provisional: true, revision: 1, tier: 0 });
    assert.equal(headlineOnly.headline, 'one two three four five six seven eight…', 'clamped to 8 words');
    assert.equal(headlineOnly.say, null);
    assert.equal(headlineOnly.provisional, true);
    assert.equal(headlineOnly.tier, 0);
    const sayOnly = mapCoachCard({ card: { id: 's', moment: 'weird', say: 'Speak this.', priority: 'urgent', trigger: 'bogus', ttl_ms: -1 } });
    assert.equal(sayOnly.moment, 'info');
    assert.equal(sayOnly.headline, 'Info', 'label derived from the moment');
    assert.equal(sayOnly.priority, 'normal');
    assert.equal(sayOnly.trigger, 'auto');
    assert.equal(sayOnly.ttlMs, undefined, 'policy default applies');
    assert.equal(sayOnly.revision, 1);
});

test('strip, moment, nudges and deal health mappers', () => {
    const strip = mapStrip({ type: 'strip', intent: 'pricing_question', label: 'Pricing question', ask_next: 'Kitne users ke liye plan karna hai?', stage: 'pricing', turn_index: 4, latency_ms: 380 });
    assert.equal(strip.label, 'Pricing question');
    assert.equal(strip.askNext, 'Kitne users ke liye plan karna hai?');
    assert.equal(strip.turnIndex, 4);
    assert.equal(mapStrip({ intent: 'buying_signal' }).label, 'Buying Signal', 'label derived from the intent');
    assert.equal(mapStrip({}), null);

    assert.deepEqual(mapMoment({ type: 'moment', moment: 'competitor', entity: 'Tally', turn_index: 3 }), { moment: 'competitor', entity: 'Tally', turnIndex: 3 });
    assert.equal(mapMoment({ type: 'moment' }), null);

    assert.deepEqual(mapNudges([{ kind: 'monologue', text: "You've been talking 2:30" }, { kind: 'bogus', text: 'x' }, { kind: 'silence' }, null]), [
        { kind: 'monologue', text: "You've been talking 2:30" }, { kind: 'info', text: 'x' },
    ]);

    const health = mapDealHealth({ type: 'deal_health', score: 143.7, rationale: ['3 of 8 fields', ''], coverage: { metrics: true } });
    assert.equal(health.score, 100);
    assert.deepEqual(health.rationale, ['3 of 8 fields']);
    assert.equal(mapDealHealth({ score: null }).score, null);
});

test('mapMetrics and describeMetrics turn numbers into benchmarked rows', () => {
    const metrics = mapMetrics({ metrics: { elapsed_s: 1800, rep_talk_s: 1100, prospect_talk_s: 500, talk_ratio_rep: 0.69, longest_monologue_rep_s: 170, questions_rep: 4, avg_rep_response_latency_s: 0.3, interruptions_rep: 5, estimated: true } });
    assert.equal(metrics.talkRatioRep, 0.69);
    assert.equal(metrics.longestMonologueRepS, 170);
    assert.equal(metrics.estimated, true);
    assert.equal(mapMetrics(null), null);
    assert.equal(mapMetrics({}).talkRatioRep, null, 'null until both have spoken');

    const rows = describeMetrics(metrics);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId.talk_ratio.value, '69%');
    assert.equal(byId.talk_ratio.tone, 'good');
    assert.equal(byId.monologue.value, '2:50');
    assert.equal(byId.monologue.tone, 'warn');
    assert.equal(byId.questions.value, '4 (8/h)');
    assert.equal(byId.patience.tone, 'warn');
    assert.equal(byId.interruptions.tone, 'warn');
    assert.equal(byId.estimated.value, 'Estimated');
    assert.equal(describeMetrics(null).length, 0);
    assert.equal(describeMetrics({ talk_ratio_rep: 0.75, elapsed_s: 600 })[0].tone, 'warn', 'raw server metrics are accepted too');
});

test('mapDealRecord counts covered fields for the progress strip', () => {
    const record = mapDealRecord({ type: 'deal_record', record: { methodology: 'bant', fields: [
        { field: 'budget', label: 'Budget', value: '₹4.5L approved', evidence_quote: 'budget approve ho gaya', speaker: 'prospect', confidence: 0.8 },
        { field: 'authority', label: 'Authority', value: null, confidence: 0 },
        { field: 'need', value: 'stock-outs', confidence: 0.6, confirmed: true },
        { bogus: true },
    ], objections: [{ type: 'pricing', handled: false }], buying_signals: [], next_step: { text: 'Pilot at Andheri', date: '2026-11-20' }, stage: 'pricing' } });
    assert.equal(record.methodology, 'bant');
    assert.equal(record.totalCount, 3);
    assert.equal(record.coveredCount, 2);
    assert.equal(record.fields[1].covered, false);
    assert.equal(record.fields[2].label, 'Need', 'label derived from the field id');
    assert.equal(record.fields[2].confirmed, true);
    assert.deepEqual(record.nextStep, { text: 'Pilot at Andheri', date: '2026-11-20' });
    assert.equal(record.objections.length, 1);
    assert.equal(mapDealRecord(null), null);
});

test('legacy aiAnalysis suggestions render through the same card shape without a TTL', () => {
    const { suggestion } = mapAnalysis(legacySuccess, { id: 's1' });
    const card = cardFromSuggestion(suggestion);
    assert.equal(card.legacy, true);
    assert.equal(card.moment, 'objection');
    assert.equal(card.headline, 'Pricing raised');
    assert.equal(card.say, legacySuccess.suggested_response);
    assert.equal(card.thenAsk, 'What does a lost customer cost you?');
    assert.equal(card.detail, 'Anchor on the cost of inaction.');
    assert.equal(card.ttlMs, null);
    const brain = cardFromSuggestion(mapAnalysis(brainComplete).suggestion);
    assert.equal(brain.headline, 'Lower the risk');
    assert.equal(brain.moment, 'info');
    assert.equal(cardFromSuggestion(null), null);
});

test('formatSpeaker maps every speaker spelling', () => {
    assert.equal(formatSpeaker('salesperson'), 'You');
    assert.equal(formatSpeaker('rep'), 'You');
    assert.equal(formatSpeaker('prospect'), 'Prospect');
    assert.equal(formatSpeaker('buyer'), 'Prospect');
    assert.equal(formatSpeaker('system'), 'System');
    assert.equal(formatSpeaker(''), 'Unknown');
});
