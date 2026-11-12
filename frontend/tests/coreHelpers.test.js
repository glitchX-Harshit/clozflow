import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayAndMonth, formatServerDateTime, parseServerDate } from '../src/lib/dates.js';
import {
    OPEN_WALLET_EVENT, buildDashboardSearch, needsWalletTopUp, openWalletTab, parseDashboardSearch, safeRedirectPath,
} from '../src/lib/dashboardLinks.js';
import { mergeProfile, sessionMessage } from '../src/context/session.js';
import { pickOption, saveErrorMessage } from '../src/pages/settings/settingsApi.js';
import { ApiError, SESSION_EXPIRED_MESSAGE } from '../src/lib/apiFetch.js';

test('server timestamps without an offset are read as UTC', () => {
    assert.equal(parseServerDate('2026-11-10T19:02:11.123456').toISOString(), '2026-11-10T19:02:11.123Z');
    assert.equal(parseServerDate('2026-11-10 19:02:11').toISOString(), '2026-11-10T19:02:11.000Z');
    assert.equal(parseServerDate('2026-11-10T19:02:11Z').toISOString(), '2026-11-10T19:02:11.000Z');
    assert.equal(parseServerDate('2026-11-10T19:02:11+05:30').toISOString(), '2026-11-10T13:32:11.000Z');
    assert.equal(parseServerDate(null), null);
    assert.equal(parseServerDate(''), null);
    assert.equal(parseServerDate('not a date'), null);
    assert.equal(formatServerDateTime(undefined, 'Just now'), 'Just now');
    assert.deepEqual(dayAndMonth(null), { day: '—', month: '' });
});

test('dashboard deep links parse and build', () => {
    assert.deepEqual(parseDashboardSearch('?tab=pearl&section=knowledge'), { tab: 'pearl', section: 'knowledge' });
    assert.deepEqual(parseDashboardSearch('?tab=settings&section=security'), { tab: 'settings', section: 'security' });
    assert.deepEqual(parseDashboardSearch('?tab=PEARL&section=nope'), { tab: 'pearl', section: null });
    assert.deepEqual(parseDashboardSearch('?tab=wallet&section=knowledge'), { tab: 'wallet', section: null });
    assert.deepEqual(parseDashboardSearch('?tab=unknown'), { tab: null, section: null });
    assert.deepEqual(parseDashboardSearch(''), { tab: null, section: null });
    assert.equal(buildDashboardSearch('overview'), '');
    assert.equal(buildDashboardSearch('pearl', 'knowledge'), '?tab=pearl&section=knowledge');
    assert.equal(buildDashboardSearch('settings', null), '?tab=settings');
    assert.equal(buildDashboardSearch('wallet', 'knowledge'), '?tab=wallet');
});

test('only an insufficient-credits refusal (402) offers the wallet', () => {
    const detail = 'Insufficient credits. Required: 2 Credits (₹2.00), Available Balance: 0.00 Credits (₹0.00).';
    const refused = new ApiError(detail, { status: 402, detail });
    assert.equal(needsWalletTopUp(refused), true);
    assert.equal(refused.message, detail); // the banner shows the server's own words
    assert.equal(needsWalletTopUp({ status: 402 }), true);
    for (const status of [0, 400, 401, 403, 404, 500, 503]) {
        assert.equal(needsWalletTopUp(new ApiError('nope', { status })), false, String(status));
    }
    assert.equal(needsWalletTopUp(new Error('network down')), false);
    assert.equal(needsWalletTopUp('402'), false);
    assert.equal(needsWalletTopUp(null), false);
    assert.equal(needsWalletTopUp(undefined), false);
});

test('openWalletTab asks the Dashboard to open Wallet & Billing', () => {
    const original = globalThis.window;
    const seen = [];
    globalThis.window = { dispatchEvent: (event) => seen.push(event.type) };
    try {
        openWalletTab();
    } finally {
        if (original === undefined) delete globalThis.window;
        else globalThis.window = original;
    }
    assert.deepEqual(seen, [OPEN_WALLET_EVENT]);
    assert.doesNotThrow(() => openWalletTab()); // no window (SSR / tests): a no-op
});

test('after sign-in only same-app paths are honoured', () => {
    assert.equal(safeRedirectPath({ pathname: '/dashboard', search: '?tab=wallet' }, '/brain'), '/dashboard?tab=wallet');
    assert.equal(safeRedirectPath('/relay/abc', '/brain'), '/relay/abc');
    assert.equal(safeRedirectPath('//evil.example/x', '/brain'), '/brain');
    assert.equal(safeRedirectPath('https://evil.example', '/brain'), '/brain');
    assert.equal(safeRedirectPath({ pathname: '/auth' }, '/dashboard'), '/dashboard');
    assert.equal(safeRedirectPath(undefined, '/dashboard'), '/dashboard');
});

test('profile hydration keeps the session id and the sign-in name', () => {
    const cloud = mergeProfile(
        { id: 'supabase-uuid', email: 'a@b.co', full_name: 'Priya Sharma', provider: 'google' },
        { id: 7, email: 'a@b.co', full_name: null, ai_override_prompt: 'Lead with ROI.', profile_image: '/static/avatars/u.png' },
        { keepNames: true },
    );
    assert.equal(cloud.id, 'supabase-uuid');
    assert.equal(cloud.full_name, 'Priya Sharma');
    assert.equal(cloud.ai_override_prompt, 'Lead with ROI.');
    assert.equal(cloud.profile_image, '/static/avatars/u.png');
    // A save that clears a field must clear it.
    assert.equal(mergeProfile({ id: 7, full_name: 'Old' }, { id: 7, full_name: null }).full_name, null);
    assert.equal(mergeProfile(null, { id: 3 }).id, 3);
});

test('settings helpers: unknown option values, readable save errors, session notices', () => {
    const tones = [{ value: 'calm' }, { value: 'strategic' }, { value: 'tactical' }];
    assert.equal(pickOption('assertive', tones, 'strategic'), 'strategic');
    assert.equal(pickOption('calm', tones, 'strategic'), 'calm');

    const tooLong = new ApiError('x', { status: 422, detail: [{ loc: ['body', 'ai_override_prompt'], msg: 'Value error, Prompt override must be 4000 characters or fewer.' }] });
    assert.match(saveErrorMessage(tooLong), /4000 characters or fewer/);
    assert.equal(saveErrorMessage(new ApiError('x', { status: 409, detail: 'Username already taken' })), 'Username already taken');
    assert.equal(saveErrorMessage(new ApiError('x', { status: 500, detail: { odd: true } })), 'Failed to save changes');
    assert.equal(saveErrorMessage(new ApiError('x', { status: 0 })), 'Failed to connect to the server');
    assert.equal(saveErrorMessage(new Error('boom')), 'Failed to save changes');

    const suspended = 'This account has been suspended or deactivated. Contact support to restore access.';
    assert.equal(sessionMessage(suspended), suspended);
    assert.equal(sessionMessage('Could not validate credentials'), SESSION_EXPIRED_MESSAGE);
    assert.equal(sessionMessage(null), SESSION_EXPIRED_MESSAGE);
});
