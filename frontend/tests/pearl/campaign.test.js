import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    campaignListMetrics, summarizeCampaigns, monitorMetrics, shouldPollCampaign, monitorSignature,
    importFeedback, formatImportFeedback, manualAddFeedback, truncate, pageInfo, pageOffsetFor,
    outcomeLabel, statusLabel, describeRecipientFailure, selectableAgents, pickCount,
    normalizeRecipientCounts, recipientsPage,
} from '../../src/pages/pearl/lib/campaignMetrics.js';
import {
    normalizeCallSettings, buildCallSettingsPayload, checkCallingWindow, providerName, normalizeProvider,
    normalizeTimezone, normalizeTime, unsupportedProvider, zoneLabel, attemptOptions, retryIntervalOptions,
    attemptLabel, retryIntervalLabel, formatRetryInterval, describeRetryPolicy, callSettingsNote,
    outsideWindowNote, windowPhrase, CALL_PROVIDERS, DEFAULT_CALL_SETTINGS,
} from '../../src/pages/pearl/lib/campaignSettings.js';

// Real `campaign_to_dict` row (routers/pearl.py) for a finished 50-recipient campaign.
const listRow = {
    id: 'c1', name: 'Q4 outreach', status: 'completed', agent_name: 'Closer',
    metrics: { total_recipients: 52, eligible_recipients: 50, completed_calls: 31, failed_calls: 19, qualified_calls: 0 },
};

test('list metrics read completed_calls / failed_calls (not the missing `dialed` / `qualified`)', () => {
    const m = campaignListMetrics(listRow);
    assert.equal(m.dialed, 50);
    assert.equal(m.total, 52);
    assert.equal(m.target, 50);
    assert.equal(m.pct, 100);
    assert.equal(m.completed, 31);
    const draft = campaignListMetrics({ metrics: { total_recipients: 10, eligible_recipients: 8, completed_calls: 0, failed_calls: 0 } });
    assert.deepEqual([draft.dialed, draft.target, draft.pct], [0, 8, 0]);
    assert.equal(campaignListMetrics({}).dialed, 0);
    assert.equal(campaignListMetrics({ metrics: null }).pct, 0);
});

test('campaign summary sums dialled and connected calls and counts running campaigns', () => {
    const s = summarizeCampaigns([listRow, { status: 'running', metrics: { completed_calls: 2, failed_calls: 1 } }, null]);
    assert.deepEqual(s, { count: 3, running: 1, dialed: 53, connected: 33 });
});

test('monitor tiles come from the flat /status shape', () => {
    const status = { status: 'running', total_recipients: 50, eligible_recipients: 50, completed: 3, calling: 2, failed: 1, started_at: '2026-11-12T10:00:00' };
    assert.deepEqual(monitorMetrics(status), { total: 50, eligible: 50, calling: 2, completed: 3, failed: 1, dialed: 6 });
    assert.deepEqual(monitorMetrics({ metrics: { dialed: 9 } }), { total: 0, eligible: 0, calling: 0, completed: 0, failed: 0, dialed: 0 });
});

test('polling stops on a finished / idle campaign but continues while calls are in flight', () => {
    assert.equal(shouldPollCampaign(null), true);
    assert.equal(shouldPollCampaign({ status: 'running', calling: 0 }), true);
    assert.equal(shouldPollCampaign({ status: 'completed', calling: 0 }), false);
    assert.equal(shouldPollCampaign({ status: 'completed', calling: 1 }), true);
    assert.equal(shouldPollCampaign({ status: 'paused', calling: 0 }), false);
    assert.equal(shouldPollCampaign({ status: 'failed' }), false);
    assert.notEqual(monitorSignature({ status: 'running', completed: 1 }), monitorSignature({ status: 'running', completed: 2 }));
    assert.equal(monitorSignature({ status: 'paused', completed: 1, started_at: 'a' }), monitorSignature({ status: 'paused', completed: 1, started_at: 'b' }));
    // a retry being scheduled (or the next one changing) refreshes the table, the window state does not
    const base = { status: 'running', completed: 1, failed: 2, retry_scheduled: 1, next_retry_at: '2026-11-12T10:30:00Z' };
    assert.notEqual(monitorSignature(base), monitorSignature({ ...base, retry_scheduled: 2 }));
    assert.notEqual(monitorSignature(base), monitorSignature({ ...base, next_retry_at: '2026-11-12T11:00:00Z' }));
    assert.equal(monitorSignature(base), monitorSignature({ ...base, dialing_state: 'waiting_for_window' }));
});

test('recipient pages carry campaign-wide per-status counts (all keys, a total)', () => {
    const page = recipientsPage({
        recipients: [{ id: 'r1' }], total: 12, limit: 50, offset: 0, retry_scheduled: 3,
        counts: { valid: 4, invalid: 1, excluded: 2, queued: 0, calling: 1, completed: 3, failed: 5 },
    });
    assert.equal(page.list.length, 1);
    assert.equal(page.total, 12); // rows matching the status filter
    assert.equal(page.retryScheduled, 3);
    assert.deepEqual(page.counts, { valid: 4, invalid: 1, excluded: 2, queued: 0, calling: 1, completed: 3, failed: 5, total: 16 });
    // older servers send no counts: null, never zeros
    assert.equal(recipientsPage({ recipients: [], total: 0 }).counts, null);
    assert.deepEqual(recipientsPage(null), { list: [], total: 0, counts: null, retryScheduled: 0 });
    // an unknown status still counts towards the total
    assert.equal(normalizeRecipientCounts({ valid: 1, weird: 2 }).total, 3);
    assert.equal(normalizeRecipientCounts(undefined).failed, 0);
});

test('import feedback reads valid_count / invalid_count / duplicate_count', () => {
    const result = {
        ok: true,
        stats: { total_rows: 5, valid_count: 3, invalid_count: 1, duplicate_count: 1, eligible_count: 3 },
        imported_count: 5, total_campaign_recipients: 105, eligible_count: 98, recipients: [],
    };
    const fb = importFeedback(result);
    assert.deepEqual(fb, { rows: 5, valid: 3, invalid: 1, duplicates: 1, imported: 5, eligible: 98, totalRecipients: 105 });
    const msg = formatImportFeedback(fb);
    assert.equal(msg.tone, 'info');
    assert.match(msg.text, /5 rows processed — 3 valid, 1 invalid \(will not be called\), 1 duplicate \(kept as excluded\)/);
    assert.match(msg.text, /98 callable recipients/);
    assert.equal(formatImportFeedback(importFeedback({ stats: { total_rows: 2, valid_count: 0, invalid_count: 2 } })).tone, 'warning');
    assert.equal(formatImportFeedback(importFeedback({ stats: { total_rows: 1, valid_count: 1 } })).tone, 'success');
    // legacy keys still work; missing campaign counts stay null (not 0)
    const legacy = importFeedback({ stats: { valid: 2, invalid: 0, duplicates: 1 } });
    assert.deepEqual([legacy.rows, legacy.valid, legacy.duplicates, legacy.eligible, legacy.totalRecipients], [3, 2, 1, null, null]);
});

test('manual add: invalid and duplicate numbers are warnings, not success', () => {
    const ok = manualAddFeedback({ recipient: { name: 'Asha', status: 'valid', normalized_phone: '+919876543210' }, eligible_count: 4 });
    assert.equal(ok.tone, 'success');
    assert.match(ok.text, /\+919876543210/);
    const bad = manualAddFeedback({ recipient: { name: 'Ravi', status: 'invalid', validation_error: 'Invalid Indian phone number format' } });
    assert.equal(bad.tone, 'warning');
    assert.match(bad.text, /number is invalid: Invalid Indian phone number format\. It will not be called/);
    const dup = manualAddFeedback({ recipient: { business_name: 'Apex', status: 'excluded', validation_error: 'Duplicate phone number detected (+919876543210)' } });
    assert.equal(dup.tone, 'warning');
    assert.match(dup.text, /^Apex was added but excluded: Duplicate/);
});

test('truncate adds an ellipsis only when text was cut', () => {
    assert.equal(truncate('Short objective', 50), 'Short objective');
    assert.equal(truncate('x'.repeat(60), 50).length, 50);
    assert.ok(truncate('x'.repeat(60), 50).endsWith('…'));
    assert.equal(truncate(null, 10), '');
    assert.equal(truncate(undefined, 10), '');
});

test('pagination labels and offsets', () => {
    assert.equal(pageInfo(0, 50, 450).label, 'Showing 1–50 of 450');
    assert.equal(pageInfo(400, 50, 450).hasNext, false);
    assert.equal(pageInfo(50, 50, 450).hasPrev, true);
    assert.equal(pageInfo(0, 0, 0).label, 'No recipients');
    assert.equal(pageOffsetFor(120, 50), 100);
    assert.equal(pageOffsetFor(0, 50), 0);
    assert.equal(pickCount(undefined, 7), 7);
    assert.equal(pickCount(3, 7), 3);
    assert.equal(pickCount(null, 7), 7);
});

test('outcome / status labels and provider-aware failure copy', () => {
    assert.equal(outcomeLabel('no_answer'), 'No answer');
    assert.equal(outcomeLabel('busy'), 'Busy');
    assert.equal(outcomeLabel('qualified'), 'Qualified');
    assert.equal(outcomeLabel(''), null);
    assert.equal(statusLabel('running'), 'Running');
    const low = describeRecipientFailure({ error_reason: 'Insufficient balance in account', outcome: 'failed' }, 'Vobiz');
    assert.equal(low.short, 'Vobiz: low balance');
    assert.match(low.detail, /Vobiz account/);
    assert.doesNotMatch(JSON.stringify(low), /Exotel|403/);
    const busy = describeRecipientFailure({ error_reason: 'USER_BUSY', outcome: 'busy' }, 'Exotel');
    assert.equal(busy.title, 'Busy');
    assert.equal(busy.short, 'USER_BUSY');
    assert.equal(describeRecipientFailure({}, 'Vobiz').detail, 'The call could not be completed.');
});

test('implicit console / draft-dialer agents are hidden from the agent picker', () => {
    const agents = [
        { id: 'a1', name: 'Closer', provider_agent_id: null },
        { id: 'a2', name: 'Pearl Execution Engine', provider_agent_id: 'pearl-console' },
        { id: 'a3', name: 'Draft Agent', provider_agent_id: 'pearl-draft-dialer' },
    ];
    assert.deepEqual(selectableAgents(agents).map((a) => a.id), ['a1']);
    assert.deepEqual(selectableAgents(null), []);
});

// ── Call settings ────────────────────────────────────────────────────────────
test('only Vobiz and Exotel are offered; a stored unsupported gateway is reported, the form shows Vobiz', () => {
    assert.deepEqual(CALL_PROVIDERS.map((p) => p.id), ['vobiz', 'exotel']);
    assert.equal(normalizeProvider('twilio'), 'vobiz');
    assert.equal(normalizeProvider('EXOTEL'), 'exotel');
    assert.equal(providerName('smartflo'), 'Vobiz');
    assert.equal(providerName('exotel'), 'Exotel');
    // the dialer refuses these at /launch and /resume (400), so the wizard says so
    assert.equal(unsupportedProvider('smartflo'), 'smartflo');
    assert.equal(unsupportedProvider(' Twilio '), 'Twilio');
    assert.equal(unsupportedProvider('EXOTEL'), null);
    assert.equal(unsupportedProvider('vobiz'), null);
    assert.equal(unsupportedProvider(''), null);
    assert.equal(unsupportedProvider(undefined), null);
});

test('server defaults normalise to valid form options, retries included', () => {
    // create_campaign's default call_settings: 2 attempts, 30 minutes apart — what the dialer does with it
    const serverDefault = { calling_hours: '09:00 - 18:00', timezone: 'Asia/Kolkata (IST)', max_attempts: 2, retry_interval: 30, concurrency_limit: 1 };
    const s = normalizeCallSettings(serverDefault);
    assert.deepEqual(s, {
        call_provider: 'vobiz', concurrency_limit: 1, window_start: '09:00', window_end: '18:00', timezone: 'Asia/Kolkata',
        max_attempts: 2, retry_interval: 30,
    });
    assert.equal(normalizeTimezone('Mars/Olympus'), 'Asia/Kolkata');
    assert.equal(normalizeCallSettings({ concurrency_limit: 9 }).concurrency_limit, 3);
    assert.equal(normalizeCallSettings({ concurrency_limit: 'x' }).concurrency_limit, 1);
    assert.equal(normalizeCallSettings({ window_start: '9:05', window_end: '25:00' }).window_start, '09:05');
    assert.equal(normalizeCallSettings({ window_start: '9:05', window_end: '25:00' }).window_end, DEFAULT_CALL_SETTINGS.window_end);
    // a new web campaign dials each recipient once until the user picks more attempts
    assert.deepEqual(normalizeCallSettings(null), { ...DEFAULT_CALL_SETTINGS });
    assert.equal(DEFAULT_CALL_SETTINGS.max_attempts, 1);
});

test('times and legacy calling hours are read like the dialer reads them', () => {
    assert.equal(normalizeTime('9:05', 'x'), '09:05');
    assert.equal(normalizeTime('09:05:30', 'x'), '09:05');
    assert.equal(normalizeTime('24:00', 'x'), '00:00'); // end of the day
    assert.equal(normalizeTime('24:30', 'x'), 'x');
    assert.equal(normalizeTime('9:5', 'x'), 'x');
    assert.equal(normalizeTime(null, 'x'), 'x');
    const s = normalizeCallSettings({ calling_hours: '10:00 to 17:30' });
    assert.deepEqual([s.window_start, s.window_end], ['10:00', '17:30']);
    assert.deepEqual(
        [normalizeCallSettings({ calling_hours: '08:00—12:00' }).window_start, normalizeCallSettings({ calling_hours: '08:00—12:00' }).window_end],
        ['08:00', '12:00'],
    );
    assert.equal('calling_hours' in buildCallSettingsPayload({ calling_hours: '10:00 - 17:00' }), false);
});

test('retries: the app spelling is read first (as the dialer does) and replaced by max_attempts + retry_interval on save', () => {
    // app-made campaign: max_retries / retry_interval_minutes win over a stale backend default
    const app = { max_retries: 3, retry_interval_minutes: 60, max_attempts: 2, retry_interval: 30, window_start: '10:00', window_end: '18:00' };
    const payload = buildCallSettingsPayload(app);
    assert.equal(payload.max_attempts, 3);
    assert.equal(payload.retry_interval, 60);
    assert.equal('max_retries' in payload, false);
    assert.equal('retry_interval_minutes' in payload, false);
    // web-made campaign
    const web = buildCallSettingsPayload({ max_attempts: 2, retry_interval: 15, call_provider: 'pulse', concurrency_limit: 2 });
    assert.deepEqual([web.max_attempts, web.retry_interval, web.call_provider, web.concurrency_limit], [2, 15, 'vobiz', 2]);
    // pacing is not offered: a stored value is kept, none is invented
    assert.equal(buildCallSettingsPayload({ pacing_seconds: 4 }).pacing_seconds, 4);
    assert.equal('pacing_seconds' in buildCallSettingsPayload({}), false);
    // ranges and bad values (clamped like the dialer; blanks fall through to the next spelling)
    assert.equal(normalizeCallSettings({ max_attempts: 25 }).max_attempts, 10);
    assert.equal(normalizeCallSettings({ max_attempts: 0 }).max_attempts, 1);
    assert.equal(normalizeCallSettings({ max_attempts: '3' }).max_attempts, 3);
    assert.equal(normalizeCallSettings({ max_attempts: true }).max_attempts, 1);
    assert.equal(normalizeCallSettings({ max_retries: '', max_attempts: 2 }).max_attempts, 2);
    assert.equal(normalizeCallSettings({ max_retries: 'many', max_attempts: 2 }).max_attempts, 1);
    assert.equal(normalizeCallSettings({ retry_interval: 5000 }).retry_interval, 1440);
    assert.equal(normalizeCallSettings({ retry_interval: -5 }).retry_interval, 0);
    assert.equal(normalizeCallSettings({ retry_interval_minutes: null, retry_interval: 45 }).retry_interval, 45);
});

test('retry controls: offered options keep a value set elsewhere; labels and summaries', () => {
    assert.deepEqual(attemptOptions(1), [1, 2, 3]);
    assert.deepEqual(attemptOptions(5), [1, 2, 3, 5]);
    assert.deepEqual(attemptOptions(42), [1, 2, 3]);
    assert.deepEqual(retryIntervalOptions(30), [15, 30, 60, 120]);
    assert.deepEqual(retryIntervalOptions(45), [15, 30, 45, 60, 120]);
    assert.deepEqual(retryIntervalOptions(0), [0, 15, 30, 60, 120]);
    assert.equal(attemptLabel(1), '1 attempt (no retries)');
    assert.equal(attemptLabel(2), '2 attempts (up to 1 retry)');
    assert.equal(attemptLabel(3), '3 attempts (up to 2 retries)');
    assert.equal(formatRetryInterval(30), '30 min');
    assert.equal(formatRetryInterval(60), '1 hour');
    assert.equal(formatRetryInterval(120), '2 hours');
    assert.equal(formatRetryInterval(0), 'no wait');
    assert.equal(retryIntervalLabel(0), 'Immediately');
    assert.equal(retryIntervalLabel(15), '15 min');
    assert.equal(describeRetryPolicy({ max_attempts: 1 }), 'One attempt per recipient (no retries)');
    assert.equal(describeRetryPolicy({ max_attempts: 3, retry_interval: 60 }), 'Up to 3 attempts per recipient, 1 hour between attempts');
    assert.equal(describeRetryPolicy({ max_retries: 2, retry_interval_minutes: 15 }), 'Up to 2 attempts per recipient, 15 min between attempts');
});

test('the settings note says the window and retries are enforced (no "not enforced" copy)', () => {
    const note = callSettingsNote({ window_start: '09:00', window_end: '19:00', timezone: 'Asia/Kolkata', max_attempts: 3, retry_interval: 30 });
    assert.match(note, /Calls only start between 09:00 and 19:00 IST/);
    assert.match(note, /starts dialing again by itself when the window opens/);
    assert.match(note, /tried again after 30 min, up to 3 attempts per recipient/);
    assert.doesNotMatch(note, /does not (pause|retry|stop)|not enforced/i);
    assert.match(callSettingsNote({ max_attempts: 1 }), /Each recipient is called once/);
    assert.match(callSettingsNote({ window_start: '10:00', window_end: '10:00' }), /any time of day/);
});

test('calling window check uses the campaign time zone and supports overnight windows', () => {
    const settings = { window_start: '09:00', window_end: '19:00', timezone: 'Asia/Kolkata' };
    // 18:00 UTC = 23:30 IST → outside
    const late = checkCallingWindow(settings, new Date('2026-11-12T18:00:00Z'));
    assert.equal(late.ok, false);
    assert.equal(late.currentTime, '23:30');
    assert.equal(late.windowLabel, '09:00–19:00 IST');
    assert.equal(late.opensAt, '09:00 IST');
    assert.equal(late.alwaysOpen, false);
    // 05:00 UTC = 10:30 IST → inside
    assert.equal(checkCallingWindow(settings, new Date('2026-11-12T05:00:00Z')).ok, true);
    // end is exclusive: 13:30 UTC = 19:00 IST
    assert.equal(checkCallingWindow(settings, new Date('2026-11-12T13:30:00Z')).ok, false);
    const overnight = { window_start: '22:00', window_end: '06:00', timezone: 'Asia/Kolkata' };
    assert.equal(checkCallingWindow(overnight, new Date('2026-11-12T18:00:00Z')).ok, true); // 23:30 IST
    assert.equal(checkCallingWindow(overnight, new Date('2026-11-12T06:30:00Z')).ok, false); // 12:00 IST
    const always = checkCallingWindow({ window_start: '09:00', window_end: '09:00' }, new Date());
    assert.equal(always.ok, true);
    assert.equal(always.alwaysOpen, true);
});

test('launching outside the window is allowed: the note says when the first calls start', () => {
    const settings = { window_start: '09:00', window_end: '19:00', timezone: 'Asia/Kolkata' };
    const outside = checkCallingWindow(settings, new Date('2026-11-12T18:00:00Z'));
    assert.equal(
        outsideWindowNote(outside),
        'It is 23:30 IST, outside the calling window (09:00–19:00 IST). You can launch now — the first calls start when the window opens at 09:00 IST.',
    );
    assert.equal(outsideWindowNote(checkCallingWindow(settings, new Date('2026-11-12T05:00:00Z'))), null);
    assert.equal(windowPhrase(outside), 'during the calling window (09:00–19:00 IST)');
    assert.equal(windowPhrase(checkCallingWindow({ window_start: '09:00', window_end: '09:00' })), 'at any time of day');
});

test('zone labels for server time zone names', () => {
    assert.equal(zoneLabel('Asia/Kolkata'), 'IST');
    assert.equal(zoneLabel('Asia/Calcutta'), 'IST');
    assert.equal(zoneLabel('Europe/Berlin'), 'Europe/Berlin'); // unknown names are shown as they are, never as IST
    assert.equal(zoneLabel(''), '');
});
