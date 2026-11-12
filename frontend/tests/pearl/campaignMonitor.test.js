import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecipientCounts } from '../../src/pages/pearl/lib/campaignMetrics.js';
import {
    DIALER_START_GRACE_MS, RECIPIENT_FILTERS, attemptsText, campaignPolicy, describeInstant, dialingNotice,
    isDialerDetached, policySummary, recipientFilterOptions, recipientFilterStatus, recipientRetryText,
    retrySummary, windowText,
} from '../../src/pages/pearl/lib/campaignMonitor.js';

// 16:00 UTC = 21:30 IST on 12 Nov 2026
const NOW = new Date('2026-11-12T16:00:00Z');
const WINDOW = { start: '09:00', end: '18:00', timezone: 'Asia/Kolkata', open: false, next_open_at: '2026-11-13T03:30:00Z' };

test('server instants are phrased in the campaign time zone (today / tomorrow / a date)', () => {
    assert.equal(describeInstant('2026-11-12T17:00:00Z', 'Asia/Kolkata', NOW), 'at 22:30 IST');
    assert.equal(describeInstant('2026-11-13T03:30:00Z', 'Asia/Kolkata', NOW), 'tomorrow at 09:00 IST');
    assert.equal(describeInstant('2026-11-15T03:30:00Z', 'Asia/Kolkata', NOW), 'on 15 Nov at 09:00 IST');
    // the IST day already changed although it is still 12 Nov in UTC
    assert.equal(describeInstant('2026-11-12T19:00:00Z', 'Asia/Kolkata', NOW), 'tomorrow at 00:30 IST');
    assert.equal(describeInstant(null, 'Asia/Kolkata', NOW), '');
    assert.equal(describeInstant('garbage', 'Asia/Kolkata', NOW), '');
    // an unknown zone falls back to the viewer's local time, without a zone label
    assert.match(describeInstant('2026-11-13T03:30:00Z', 'Mars/Olympus', NOW), /^(at|tomorrow at|on \d{1,2} \w{3} at) \d{2}:\d{2}$/);
});

test('calling window text: none / always-open windows have no text', () => {
    assert.equal(windowText(WINDOW), '09:00–18:00 IST');
    assert.equal(windowText({ start: '09:00', end: '09:00', timezone: 'Asia/Kolkata' }), '');
    assert.equal(windowText(null), '');
});

test('the policy comes from effective_call_settings (what the dialer does), else the stored settings', () => {
    const campaign = {
        call_settings: { call_provider: 'smartflo', max_retries: 3 },
        effective_call_settings: {
            call_provider: 'vobiz', timezone: 'Asia/Kolkata', concurrency_limit: 2, max_attempts: 3,
            retry_interval_minutes: 30.0, pacing_seconds: 2.0,
            calling_window: { start: '09:00', end: '18:00', timezone: 'Asia/Kolkata', open: true, next_open_at: null },
        },
    };
    const p = campaignPolicy(campaign);
    assert.deepEqual(p, {
        provider: 'Vobiz', concurrency: 2, maxAttempts: 3, retryIntervalMinutes: 30, timezone: 'Asia/Kolkata',
        window: { start: '09:00', end: '18:00', timezone: 'Asia/Kolkata' },
    });
    assert.deepEqual(policySummary(p), [
        'Vobiz gateway', 'up to 2 calls at a time', 'calls 09:00–18:00 IST',
        'Up to 3 attempts per recipient, 30 min between attempts',
    ]);
    // no window restriction
    const open = campaignPolicy({ effective_call_settings: { call_provider: 'exotel', calling_window: null, max_attempts: 1 } });
    assert.equal(open.window, null);
    assert.equal(open.provider, 'Exotel');
    assert.equal(policySummary(open)[2], 'calls at any hour');
    assert.equal(policySummary(open)[3], 'One attempt per recipient (no retries)');
    // older server: the stored settings
    const legacy = campaignPolicy({ call_settings: { window_start: '10:00', window_end: '17:00', timezone: 'Asia/Dubai', max_attempts: 2, retry_interval: 15 } });
    assert.deepEqual([legacy.maxAttempts, legacy.retryIntervalMinutes, legacy.timezone], [2, 15, 'Asia/Dubai']);
    assert.deepEqual(legacy.window, { start: '10:00', end: '17:00', timezone: 'Asia/Dubai' });
    assert.equal(campaignPolicy(null).provider, 'Vobiz');
});

test('dialing notice: waiting for the calling window says when it opens', () => {
    const status = { status: 'running', dialing_state: 'waiting_for_window', calling_window: WINDOW, dialer_active: true };
    const notice = dialingNotice(status, { now: NOW });
    assert.equal(notice.kind, 'window');
    assert.equal(notice.tone, 'info');
    assert.match(notice.text, /^Waiting for the calling window \(opens tomorrow at 09:00 IST\)\./);
    assert.match(notice.text, /No new calls start outside 09:00–18:00 IST/);
    assert.match(notice.text, /dialing resumes by itself/);
});

test('dialing notice: waiting for a retry, waiting for calls in progress, nothing while dialing', () => {
    const retry = dialingNotice({
        status: 'running', dialing_state: 'waiting_for_retry', retry_scheduled: 2, next_retry_at: '2026-11-12T16:30:00Z', calling_window: null,
    }, { now: NOW, timeZone: 'Asia/Kolkata' });
    assert.equal(retry.kind, 'retry');
    assert.equal(retry.text, 'No calls are due right now. 2 recipients are waiting for another attempt — the next one at 22:00 IST.');
    const calls = dialingNotice({ status: 'running', dialing_state: 'waiting_for_calls', calling: 1 }, { now: NOW });
    assert.equal(calls.text, 'Every recipient has been dialed. Waiting for 1 call in progress to finish.');
    assert.equal(dialingNotice({ status: 'running', dialing_state: 'dialing' }, { now: NOW }), null);
    assert.equal(dialingNotice({ status: 'paused', dialing_state: null }, { now: NOW }), null);
    assert.equal(dialingNotice(null), null);
});

test('scheduled retries are summarised for the failed-calls tile', () => {
    assert.equal(
        retrySummary({ retry_scheduled: 3, next_retry_at: '2026-11-12T16:30:00Z', calling_window: WINDOW }, { now: NOW }),
        '3 waiting to retry · next at 22:00 IST',
    );
    assert.equal(retrySummary({ retry_scheduled: 0 }, { now: NOW }), '');
    assert.equal(retrySummary({ retry_scheduled: 1 }, { now: NOW }), '1 waiting to retry');
});

test('dialer_active: false on a running campaign offers Resume (after a short grace following our own start)', () => {
    const now = 1_000_000;
    const orphan = { status: 'running', dialer_active: false };
    assert.equal(isDialerDetached(orphan, { now }), true);
    assert.equal(isDialerDetached(orphan, { now, startedAt: now - 2000 }), false); // just launched / resumed here
    assert.equal(isDialerDetached(orphan, { now, startedAt: now - DIALER_START_GRACE_MS - 1 }), true);
    assert.equal(isDialerDetached({ status: 'running', dialer_active: true }, { now }), false);
    assert.equal(isDialerDetached({ status: 'running' }, { now }), false); // older servers: unknown
    assert.equal(isDialerDetached({ status: 'paused', dialer_active: false }, { now }), false);
    assert.equal(isDialerDetached(null, { now }), false);
});

test('recipient rows: scheduled retry time and attempts out of the maximum', () => {
    const r = { status: 'failed', retry_scheduled: true, next_attempt_at: '2026-11-13T03:30:00Z' };
    assert.equal(recipientRetryText(r, { now: NOW, timeZone: 'Asia/Kolkata' }), 'Retry tomorrow at 09:00 IST');
    assert.equal(recipientRetryText({ retry_scheduled: true }, { now: NOW }), 'Retry scheduled');
    assert.equal(recipientRetryText({ status: 'failed', retry_scheduled: false }, { now: NOW }), '');
    assert.equal(attemptsText(2, 3), '2 of 3');
    assert.equal(attemptsText(1, 1), '1');
    assert.equal(attemptsText(null, 3), '0 of 3');
});

test('recipient filter: ?status= values and labels with campaign-wide counts', () => {
    assert.equal(recipientFilterStatus('all'), '');
    assert.equal(recipientFilterStatus('waiting'), 'valid,queued');
    assert.equal(recipientFilterStatus('failed'), 'failed');
    assert.equal(recipientFilterStatus('skipped'), 'invalid,excluded');
    assert.equal(recipientFilterStatus('nope'), '');
    const counts = normalizeRecipientCounts({ valid: 4, invalid: 1, excluded: 2, queued: 1, calling: 1, completed: 3, failed: 5 });
    const options = recipientFilterOptions(counts, 2);
    assert.deepEqual(options.map((o) => o.id), RECIPIENT_FILTERS.map((f) => f.id));
    assert.deepEqual(options.map((o) => o.label), [
        'All recipients (17)', 'Not called yet (5)', 'Calling now (1)', 'Completed (3)',
        'Failed / unanswered (5, 2 awaiting retry)', 'Invalid / excluded (3)',
    ]);
    // counts not loaded yet: no made-up numbers
    assert.equal(recipientFilterOptions(null)[0].label, 'All recipients');
});
