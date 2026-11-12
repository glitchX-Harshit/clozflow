import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_TTL_MS,
    HIGH_TTL_MS,
    PREVIOUS_KEEP_MS,
    chipText,
    createCardPolicy,
    momentAllowed,
    splitSentences,
    ttlFor,
} from '../src/lib/cardPolicy.js';

function clock(start = 1000) {
    let t = start;
    return { now: () => t, advance: (ms) => { t += ms; return t; }, at: () => t };
}

const card = (overrides = {}) => ({
    id: overrides.id || `c-${Math.random().toString(36).slice(2, 6)}`,
    moment: 'pricing',
    priority: 'normal',
    headline: 'Price pushback',
    say: 'Fair point. Most bakeries recover the fee in the first month from fewer stock-outs. Shall I show you how?',
    trigger: 'auto',
    ...overrides,
});

test('ttlFor: explicit ttl_ms wins, high priority gets 15 s, legacy null never expires', () => {
    assert.equal(ttlFor({ priority: 'normal' }), DEFAULT_TTL_MS);
    assert.equal(ttlFor({ priority: 'high' }), HIGH_TTL_MS);
    assert.equal(ttlFor({ ttl_ms: 9000 }), 9000);
    assert.equal(ttlFor({ ttlMs: 7000, priority: 'high' }), 7000);
    assert.equal(ttlFor({ ttlMs: null }), null);
});

test('a card shows, auto-dismisses after its TTL and becomes "previous"', () => {
    const c = clock();
    const policy = createCardPolicy({ now: c.now });
    const first = card({ id: 'a' });
    assert.deepEqual(policy.receiveCard(first), { accepted: true, reason: null });
    assert.equal(policy.snapshot().card.id, 'a');
    assert.equal(policy.remainingMs(), DEFAULT_TTL_MS);

    c.advance(DEFAULT_TTL_MS - 1);
    assert.equal(policy.expire(), false);
    c.advance(1);
    assert.equal(policy.expire(), true);
    const snap = policy.snapshot();
    assert.equal(snap.card, null);
    assert.equal(snap.previous.id, 'a', 'the dismissed card is reachable as previous');
    assert.equal(snap.history[0].id, 'a');
});

test('hover pauses the timer and keeps the remaining time; pin stops it', () => {
    const c = clock();
    const policy = createCardPolicy({ now: c.now });
    policy.receiveCard(card({ id: 'a' }));
    c.advance(4000);
    policy.hoverStart();
    c.advance(30000); // reading for a long time
    assert.equal(policy.expire(), false, 'never expires while hovered');
    assert.equal(policy.remainingMs(), DEFAULT_TTL_MS - 4000, 'remaining time frozen at hover start');
    policy.hoverEnd();
    c.advance(DEFAULT_TTL_MS - 4000 - 1);
    assert.equal(policy.expire(), false);
    c.advance(1);
    assert.equal(policy.expire(), true);

    policy.receiveCard(card({ id: 'b', moment: 'competitor', headline: 'Competitor: Tally' }));
    assert.equal(policy.pin(), true);
    assert.equal(policy.remainingMs(), null);
    c.advance(10 * 60000);
    assert.equal(policy.expire(), false, 'pinned cards never expire');
    assert.equal(policy.snapshot().card.pinned, true);
    policy.unpin();
    assert.equal(policy.remainingMs(), DEFAULT_TTL_MS);
});

test('a revision with the same id updates the visible card in place and restarts the TTL', () => {
    const c = clock();
    const policy = createCardPolicy({ now: c.now });
    policy.receiveCard(card({ id: 'a', say: 'Fair point.', provisional: true, revision: 1 }));
    const shownAt = policy.snapshot().card.shownAt;
    c.advance(1500);
    const result = policy.receiveCard(card({ id: 'a', say: 'Fair point. Most bakeries recover the fee in month one.', provisional: false, revision: 2, then_ask: 'Shall I show you?' }));
    assert.deepEqual(result, { accepted: true, reason: 'revision' });
    const snap = policy.snapshot();
    assert.equal(snap.card.id, 'a');
    assert.equal(snap.card.shownAt, shownAt, 'not a new card');
    assert.equal(snap.card.provisional, false);
    assert.equal(snap.card.revision, 2);
    assert.match(snap.card.say, /month one/);
    assert.equal(snap.previous, null, 'a revision is not a replacement');
    assert.equal(policy.remainingMs(), DEFAULT_TTL_MS, 'the completed text gets a full read window');
});

test('a pinned card moves aside when the next card arrives; revisions reach the pinned slot too', () => {
    const c = clock();
    const policy = createCardPolicy({ now: c.now });
    policy.receiveCard(card({ id: 'a' }));
    policy.pin();
    policy.receiveCard(card({ id: 'b', moment: 'competitor', headline: 'Competitor: Tally', entity: 'Tally' }));
    let snap = policy.snapshot();
    assert.equal(snap.card.id, 'b');
    assert.equal(snap.pinned.id, 'a');
    policy.receiveCard(card({ id: 'a', say: 'Updated text', revision: 3 }));
    snap = policy.snapshot();
    assert.equal(snap.pinned.say, 'Updated text');
    assert.equal(policy.dismissPinned(), true);
    assert.equal(policy.snapshot().pinned, null);
});

test('snoozed moments are dropped (and the visible one retired); on-demand cards bypass the snooze', () => {
    const c = clock();
    const policy = createCardPolicy({ now: c.now });
    policy.receiveCard(card({ id: 'a' }));
    policy.snooze('pricing', 5 * 60000);
    assert.equal(policy.snapshot().card, null, 'the current pricing card is retired');
    assert.deepEqual(policy.receiveCard(card({ id: 'b' })), { accepted: false, reason: 'snoozed' });
    assert.deepEqual(policy.receiveCard(card({ id: 'c', trigger: 'on_demand' })), { accepted: true, reason: null });
    assert.equal(policy.isSnoozed('pricing'), true);
    assert.equal(policy.snapshot().snoozed[0].moment, 'pricing');
    c.advance(5 * 60000);
    assert.equal(policy.isSnoozed('pricing'), false, 'snooze lifts on its own');
    assert.equal(policy.receiveCard(card({ id: 'd' })).accepted, true);
});

test('duplicates (same moment, battlecard, headline) are dropped inside the dedupe window', () => {
    const c = clock();
    const policy = createCardPolicy({ now: c.now });
    assert.equal(policy.receiveCard(card({ id: 'a', battlecard_id: 'obj-price' })).accepted, true);
    c.advance(30000);
    assert.deepEqual(policy.receiveCard(card({ id: 'b', battlecard_id: 'obj-price' })), { accepted: false, reason: 'duplicate' });
    assert.equal(policy.receiveCard(card({ id: 'c', battlecard_id: 'obj-price', trigger: 'ask' })).accepted, true, 'on-demand bypasses dedupe');
    c.advance(61000);
    assert.equal(policy.receiveCard(card({ id: 'd', battlecard_id: 'obj-price' })).accepted, true, 'accepted again after 60 s');
    // Light intensity dedupes for 120 s.
    const light = createCardPolicy({ now: c.now });
    light.receiveCard(card({ id: 'x' }), c.now(), { intensity: 'light' });
    c.advance(90000);
    assert.equal(light.receiveCard(card({ id: 'y' }), c.now(), { intensity: 'light' }).reason, 'duplicate');
});

test('intensity gate: off/on-demand make chips, light keeps the four core moments, guided adds signals, full takes all', () => {
    assert.equal(momentAllowed('buying_signal', 'light'), false);
    assert.equal(momentAllowed('buying_signal', 'guided'), true);
    assert.equal(momentAllowed('silence', 'guided'), false);
    assert.equal(momentAllowed('silence', 'full'), true);
    assert.equal(momentAllowed('objection', 'off'), false);

    const policy = createCardPolicy({ now: clock().now });
    assert.deepEqual(policy.receiveCard(card({ id: 'a' }), undefined, { intensity: 'off' }), { accepted: false, reason: 'intensity' });
    assert.equal(policy.snapshot().chips[0].moment, 'pricing', 'still shown as a chip');
    assert.deepEqual(policy.receiveCard(card({ id: 'b', moment: 'buying_signal' }), undefined, { intensity: 'light' }), { accepted: false, reason: 'chip' });
    assert.equal(policy.receiveCard(card({ id: 'c', moment: 'buying_signal' }), undefined, { intensity: 'guided' }).accepted, true);
    assert.equal(policy.receiveCard(card({ id: 'd', trigger: 'on_demand' }), undefined, { intensity: 'off' }).accepted, true, 'hotkey answers even when off');
    assert.equal(policy.receiveCard(card({ id: 'e', moment: 'info', legacy: true }), undefined, { intensity: 'guided' }).accepted, true, 'legacy aiAnalysis cards are not gated');
});

test('previous card is reachable for 60 s and can be restored', () => {
    const c = clock();
    const policy = createCardPolicy({ now: c.now });
    policy.receiveCard(card({ id: 'a' }));
    c.advance(3000);
    policy.receiveCard(card({ id: 'b', moment: 'competitor', headline: 'Competitor: Tally' }));
    assert.equal(policy.snapshot().previous.id, 'a');
    assert.equal(policy.restorePrevious(), true);
    let snap = policy.snapshot();
    assert.equal(snap.card.id, 'a');
    assert.equal(snap.previous.id, 'b', 'the swap is symmetric');
    c.advance(PREVIOUS_KEEP_MS);
    snap = policy.snapshot();
    assert.equal(snap.previous, null, 'previous is forgotten after 60 s');
    assert.equal(policy.restorePrevious(), false);
});

test('chips keep the last three moments, newest first, unique per moment, with entity text', () => {
    const c = clock();
    const policy = createCardPolicy({ now: c.now });
    policy.receiveMoment({ moment: 'question', entity: null });
    policy.receiveMoment({ moment: 'competitor', entity: 'Tally' });
    policy.receiveMoment({ moment: 'buying_signal', entity: 'asked about rollout' });
    policy.receiveMoment({ moment: 'competitor', entity: 'Zoho' });
    policy.receiveMoment({ moment: 'stall' });
    const chips = policy.snapshot().chips;
    assert.deepEqual(chips.map((ch) => ch.moment), ['stall', 'competitor', 'buying_signal']);
    assert.equal(chipText(chips[1]), 'Competitor · Zoho');
    assert.equal(chipText({ moment: 'next_step_missing' }), 'No next step yet');
});

test('late and provisional cards are accepted; cards without text are not', () => {
    const policy = createCardPolicy({ now: clock().now });
    assert.deepEqual(policy.receiveCard({ id: 'x' }), { accepted: false, reason: 'invalid' });
    assert.equal(policy.receiveCard(card({ id: 'a', late: true })).accepted, true);
    assert.equal(policy.snapshot().card.late, true);
    assert.equal(policy.receiveCard({ id: 'b', moment: 'objection', say: 'Headline-less but speakable.', trigger: 'auto' }).accepted, true);
});

test('setAutoDismiss(false) keeps cards until replaced (WCAG timing control)', () => {
    const c = clock();
    const policy = createCardPolicy({ now: c.now, autoDismiss: false });
    policy.receiveCard(card({ id: 'a' }));
    assert.equal(policy.remainingMs(), null);
    c.advance(10 * 60000);
    assert.equal(policy.expire(), false);
    policy.setAutoDismiss(true);
    policy.receiveCard(card({ id: 'b', moment: 'objection' }));
    assert.equal(policy.remainingMs(), DEFAULT_TTL_MS);
});

test('splitSentences handles English, Hinglish and the Devanagari danda', () => {
    assert.deepEqual(splitSentences('Fair point. Most teams start small! Shall we?'), ['Fair point.', 'Most teams start small!', 'Shall we?']);
    assert.deepEqual(splitSentences('Bilkul samajh sakta hoon। Pehle ek outlet pe try karte hain.'), ['Bilkul samajh sakta hoon।', 'Pehle ek outlet pe try karte hain.']);
    assert.deepEqual(splitSentences('No terminal punctuation'), ['No terminal punctuation']);
    assert.deepEqual(splitSentences(''), []);
});
