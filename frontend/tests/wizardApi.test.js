import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../src/lib/apiFetch.js';
import {
    INTENSITIES,
    PLATFORMS,
    SAMPLE_MEETINGS,
    buildMailto,
    buildWaMeUrl,
    channelForPlatform,
    crmPayloadText,
    filterLeads,
    formatInr,
    generateBrief,
    getDebrief,
    inrInWords,
    isWizardUnavailable,
    mapBattlecard,
    mapBrief,
    mapDebrief,
    mapHome,
    mapIntegrations,
    mapMeeting,
    mapPreflight,
    meetingFromLead,
    methodologyFields,
    minutesUntil,
    outcomeInfo,
    parseDealValue,
    platformFromLink,
    relativeStart,
    sendDebrief,
    startMeeting,
    startsAround,
} from '../src/lib/wizardApi.js';

test('deal values: lakh/crore helper mirrors the server parser', () => {
    assert.equal(formatInr(450000), '₹4,50,000');
    assert.equal(formatInr(12000000), '₹1,20,00,000');
    assert.equal(formatInr(999), '₹999');
    assert.equal(inrInWords(450000), '4.5 lakh');
    assert.equal(inrInWords(12000000), '1.2 crore');
    assert.equal(inrInWords(50000), '50 thousand');

    assert.equal(parseDealValue('₹4.5L').inr, 450000);
    assert.equal(parseDealValue('4,50,000').inr, 450000);
    assert.equal(parseDealValue('12 lakh').inr, 1200000);
    assert.equal(parseDealValue('1.2 cr').inr, 12000000);
    assert.equal(parseDealValue('₹28 lakh ARR').words, '₹28,00,000 (28 lakh)');
    assert.equal(parseDealValue('$2,400 / mo').inr, null, 'foreign currency is kept as typed');
    assert.deepEqual(parseDealValue(''), { inr: null, words: '', text: '' });
    assert.equal(parseDealValue('abc').inr, null);
});

test('starting-now window and relative labels', () => {
    const now = new Date('2026-11-12T10:00:00Z').getTime();
    assert.equal(minutesUntil('2026-11-12T10:08:00Z', now), 8);
    assert.equal(startsAround('2026-11-12T10:08:00Z', now), true);
    assert.equal(startsAround('2026-11-12T09:52:00Z', now), true, 'started 8 min ago still counts');
    assert.equal(startsAround('2026-11-12T10:11:00Z', now), false);
    assert.equal(startsAround(null, now), false);
    assert.equal(relativeStart('2026-11-12T10:08:00Z', now), 'in 8 min');
    assert.equal(relativeStart('2026-11-12T10:00:30Z', now), 'now');
    assert.equal(relativeStart('2026-11-12T09:30:00Z', now), '30 min ago');
    assert.equal(relativeStart('2026-11-12T13:00:00Z', now), 'in 3 h');
    // Offset-less server timestamps are UTC.
    assert.equal(minutesUntil('2026-11-12 10:05:00', now), 5);
});

test('platform detection, channel mapping and vocabularies', () => {
    assert.equal(platformFromLink('https://meet.google.com/abc-defg-hij'), 'meet');
    assert.equal(platformFromLink('https://us02web.zoom.us/j/123'), 'zoom');
    assert.equal(platformFromLink('https://teams.microsoft.com/l/meetup-join/x'), 'teams');
    assert.equal(platformFromLink('https://example.com'), 'other');
    assert.equal(platformFromLink(''), null);
    assert.equal(channelForPlatform('meet'), 'tab_audio');
    assert.equal(channelForPlatform('in_person'), 'mic');
    assert.equal(channelForPlatform('phone'), 'phone_bridge');
    assert.deepEqual(INTENSITIES.map((i) => i.id), ['full', 'guided', 'light', 'on_demand', 'off']);
    assert.equal(PLATFORMS.length, 5);
    assert.equal(methodologyFields('bant').length, 4);
    assert.equal(methodologyFields('unknown')[0].field, 'pain', 'unknown framework falls back to the plain checklist');
    assert.equal(outcomeInfo('next_step_set').tone, 'good');
    assert.equal(outcomeInfo('made_up').label, 'Outcome unclear');
    assert.equal(SAMPLE_MEETINGS.length, 2);
});

test('mailto, wa.me and CRM clipboard text', () => {
    const mailto = buildMailto({ to: 'rohan@acme.in', subject: 'Recap: Acme × ClozFlow', body: 'Hi Rohan,\nThanks!', bcc: 'crm@zoho.example' });
    assert.ok(mailto.startsWith('mailto:rohan%40acme.in?subject=Recap%3A%20Acme%20%C3%97%20ClozFlow&body=Hi%20Rohan%2C%0AThanks!'));
    assert.ok(mailto.endsWith('&bcc=crm%40zoho.example'));
    assert.equal(buildMailto({ to: 'a@b.c' }), 'mailto:a%40b.c');
    assert.equal(buildWaMeUrl('+91 98765-43210', 'Hi Rohan'), 'https://wa.me/919876543210?text=Hi%20Rohan');
    assert.equal(buildWaMeUrl('', 'x'), 'https://wa.me/?text=x', 'no number opens the contact picker');
    assert.equal(crmPayloadText({ deal_stage: 'Proposal', amount: 450000, empty: '', nested: { a: 1 } }), 'deal stage: Proposal\namount: 450000\nnested: {"a":1}');
    assert.equal(crmPayloadText(null), '');
});

test('battlecard mapper accepts the new Fact→Impact→Act shape and the five legacy cards', () => {
    const legacy = mapBattlecard({ id: 'pricing', title: 'Pricing Resistance', category: 'Cost & Budget', tag: 'High Impact', accent: '#ef4444', reframe: 'Expensive usually means…', psychology: 'Price pushback…', trap: 'Do not discount.' });
    assert.equal(legacy.act, 'Expensive usually means…');
    assert.equal(legacy.do_not, 'Do not discount.');
    assert.equal(legacy.read_only, true, 'no user_id → seed card');
    assert.equal(legacy.kind, 'objection');

    const own = mapBattlecard({ id: 'u1', user_id: 7, source: 'user', kind: 'competitive', title: 'vs Tally', trigger_keywords: ['tally', 'Tally Prime', 3], act: 'Tally is great for books…', do_not: 'Never trash Tally.' });
    assert.equal(own.read_only, false);
    assert.deepEqual(own.trigger_keywords, ['tally', 'Tally Prime', '3']);
    assert.equal(mapBattlecard({}), null);
});

test('meeting / brief / home mappers add safe defaults', () => {
    const meeting = mapMeeting({ id: 'm1', prospect_name: 'Rohan Mehta', platform: 'zoom', brief: { objective: 'Pilot', agenda: ['Intro', ''], likely_objections: [{ battlecard_id: 'obj-price-expensive', title: 'Too expensive' }], pre_rendered_cards: [{ id: 'obj-price-expensive', title: 'Too expensive', act: 'Say this…' }], methodology: { name: 'bant' } } });
    assert.equal(meeting.title, 'Meeting with Rohan Mehta');
    assert.equal(meeting.channel, 'tab_audio');
    assert.equal(meeting.coaching_intensity, 'guided');
    assert.deepEqual(meeting.battlecard_ids, []);
    assert.deepEqual(meeting.brief.agenda, ['Intro']);
    assert.equal(meeting.brief.pre_rendered_cards[0].act, 'Say this…');
    assert.equal(meeting.brief.methodology.name, 'bant');
    assert.equal(mapMeeting(null), null);
    assert.equal(mapBrief(null), null);

    const home = mapHome({ today: [{ id: 'e1', title: 'Discovery', start: '2026-11-12T10:00:00Z', meeting_link: 'https://meet.google.com/x', meeting_id: null }], live: null, upcoming: [], recent: [{ id: 'm2', title: 'Old', debrief: { summary: 'Agreed a pilot.', outcome: 'next_step_set' } }], stats: { meetings_30d: 7, next_step_rate: 0.57 } });
    assert.equal(home.today[0].platform, 'meet');
    assert.equal(home.recent[0].debrief_summary, 'Agreed a pilot.');
    assert.equal(home.recent[0].outcome, 'next_step_set');
    assert.equal(home.stats.avg_talk_ratio, null);
    assert.deepEqual(mapHome(undefined).today, []);
});

test('debrief, preflight and integrations mappers', () => {
    const d = mapDebrief({ status: 'ready', summary: 'BLUF', outcome: 'won', action_items: [{ text: 'Send proposal', owner: 'rep', due: '2026-11-14' }, { id: 'k', text: 'Share GST details', owner: 'prospect', done: true }], follow_up_email: { subject: 'S', body: 'B' }, sent: { email_at: null } });
    assert.equal(d.action_items[0].id, 'ai-0');
    assert.equal(d.action_items[1].done, true);
    assert.equal(d.follow_up_email.subject, 'S');
    assert.equal(mapDebrief({}).status, 'generating');

    const p = mapPreflight({ stt: { vendor: 'deepgram', ready: true }, coach: { model: 'gemini-2.5-flash-lite', ready: false }, bridge: { enabled: false, reason: 'VOBIZ not configured' } });
    assert.equal(p.stt.vendor, 'deepgram');
    assert.equal(p.coach.ready, false);
    assert.equal(p.bridge.reason, 'VOBIZ not configured');
    assert.match(p.consent_script, /ClozFlow to take notes/);

    const i = mapIntegrations({ crm_webhook_url: 'https://hooks.example/x', has_webhook_secret: true, zoho: { connected: true, org_name: 'Acme CRM' } });
    assert.equal(i.zoho.connected, true);
    assert.equal(i.zoho.org, 'Acme CRM');
    assert.equal(i.retention_days_transcript, 180);
    assert.equal(mapIntegrations({ zoho_connected: true }).zoho.connected, true, 'flat flag also accepted');
});

test('isWizardUnavailable flags an old backend (404/501) but not other errors', () => {
    assert.equal(isWizardUnavailable(new ApiError('x', { status: 404 })), true);
    assert.equal(isWizardUnavailable(new ApiError('x', { status: 501 })), true);
    assert.equal(isWizardUnavailable(new ApiError('x', { status: 500 })), false);
    assert.equal(isWizardUnavailable(new Error('boom')), false);
});

test('lead helpers: search and prefill', () => {
    const leads = [{ id: 1, business_name: 'Acme Bakery', city: 'Mumbai', category: 'Bakery', phone_number: '98200 12345', likely_pain_point: 'stock-outs' }, { id: 2, business_name: 'Zen Gyms', city: 'Pune', category: 'Fitness' }];
    assert.equal(filterLeads(leads, 'pune').length, 1);
    assert.equal(filterLeads(leads, 'BAKERY')[0].id, 1);
    assert.equal(filterLeads(leads, '').length, 2);
    const prefill = meetingFromLead(leads[0]);
    assert.equal(prefill.lead_id, 1);
    assert.equal(prefill.company, 'Acme Bakery');
    assert.match(prefill.objective, /stock-outs/);
    assert.deepEqual(meetingFromLead(null), {});
});

test('requests: paths, payloads, 202 polling and send channels', async () => {
    const calls = [];
    let nextResponse = { status: 200, text: '{}' };
    globalThis.localStorage = { getItem: (key) => (key === 'token' ? 'tok' : null) };
    globalThis.window = { APP_API_BASE: 'http://api.test' };
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        const r = nextResponse;
        return { ok: r.status < 400, status: r.status, text: async () => r.text };
    };
    try {
        nextResponse = { status: 202, text: '{"status":"generating"}' };
        const generating = await getDebrief('m1');
        assert.equal(generating.status, 'generating');
        assert.equal(calls.at(-1).url, 'http://api.test/api/wizard/meetings/m1/debrief');

        nextResponse = { status: 200, text: '{"summary":"Done","outcome":"won","action_items":[]}' };
        const ready = await getDebrief('m1');
        assert.equal(ready.status, 'ready');
        assert.equal(ready.summary, 'Done');

        nextResponse = { status: 200, text: '{"context_id":"ctx-1","ws":{"audio":"/ws/audio"},"consent_script":"Hi…","bridge":{"enabled":true,"rate_per_minute":3}}' };
        const started = await startMeeting('m1', { channel: 'tab_audio', consent: { mode: 'announced' } });
        assert.equal(started.context_id, 'ctx-1');
        assert.equal(started.bridge.enabled, true);
        const startCall = calls.at(-1);
        assert.equal(startCall.url, 'http://api.test/api/wizard/meetings/m1/start');
        assert.equal(startCall.init.method, 'POST');
        assert.deepEqual(JSON.parse(startCall.init.body), { channel: 'tab_audio', consent: { mode: 'announced' } });
        assert.equal(startCall.init.headers.Authorization, 'Bearer tok');

        nextResponse = { status: 200, text: '{"brief":{"objective":"x"},"battlecards":[{"id":"a","title":"A"}],"degraded":true}' };
        const brief = await generateBrief('m1', { force: true });
        assert.equal(calls.at(-1).url, 'http://api.test/api/wizard/meetings/m1/brief?force=1');
        assert.equal(brief.degraded, true);
        assert.equal(brief.battlecards[0].id, 'a');

        nextResponse = { status: 200, text: '{"wa_me_url":"https://wa.me/91x?text=hi"}' };
        const sent = await sendDebrief('m1', 'whatsapp');
        assert.equal(sent.wa_me_url, 'https://wa.me/91x?text=hi');
        assert.deepEqual(JSON.parse(calls.at(-1).init.body), { channel: 'whatsapp' });

        nextResponse = { status: 404, text: '{"detail":"Not Found"}' };
        await assert.rejects(getDebrief('m1'), (err) => isWizardUnavailable(err));
    } finally {
        delete globalThis.fetch;
        delete globalThis.window;
        delete globalThis.localStorage;
    }
});
