import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, SESSION_EXPIRED_MESSAGE } from '../../src/pages/pearl/lib/pearlApi.js';
import {
    JOB_NOT_FOUND_MESSAGE,
    createJobState,
    createSseParser,
    isTerminalJobStatus,
    jobReducer,
    normalizeJobStatus,
    parseJobEventData,
    stageListForJob,
    stageState,
    summarizeCapsules,
    watchKnowledgeJob,
} from '../../src/pages/pearl/lib/knowledgeJob.js';
import {
    KNOWLEDGE_UPLOAD_ACCEPT,
    approvalMeta,
    cancelImportOutcome,
    capsuleStatusMeta,
    capsulesFromSource,
    confirmPhraseForSource,
    describeImportRequest,
    documentName,
    factOriginMeta,
    hasKnowledge,
    importTargetLabel,
    isHttpUrl,
    normalizeWebsiteInput,
    patchCapsule,
    patchFact,
    phraseMatches,
    sourceFailure,
    sourceStatusMeta,
    validateKnowledgeFiles,
} from '../../src/pages/pearl/lib/knowledgeView.js';

const STAGES = [
    { stage: 1, key: 'connecting', title: 'Connecting to your website', detail: 'Validating host' },
    { stage: 2, key: 'discovering', title: 'Discovering relevant pages', detail: 'Sitemap' },
    { stage: 3, key: 'reading', title: 'Reading business information', detail: '' },
    { stage: 9, key: 'review', title: 'Preparing knowledge for review', detail: '' },
];

const ev = (data) => ({ type: 'event', data, receivedAt: 1000 });

// ── SSE parser ───────────────────────────────────────────────────────────────
test('SSE frames split across chunks (inside JSON, before the value, inside CRLF) are reassembled', () => {
    const events = [];
    const parser = createSseParser((e) => events.push(e));
    parser.push('da');
    parser.push('ta: {"status":"run');
    parser.push('ning","progress":20}\r');
    parser.push('\n\r\n: ping\n\n');
    parser.push('event: update\ndata: {"a":1}\ndata: {"b":2}\n\n');
    parser.push('data: {"status":"completed"}');
    assert.equal(events.length, 2);
    assert.deepEqual(parseJobEventData(events[0].data), { status: 'running', progress: 20 });
    assert.equal(events[1].type, 'update');
    assert.equal(events[1].data, '{"a":1}\n{"b":2}');
    parser.flush();
    assert.equal(events.length, 3);
    assert.equal(parseJobEventData(events[2].data).status, 'completed');
});

test('comments and blank events dispatch nothing; bad JSON is ignored', () => {
    const events = [];
    const parser = createSseParser((e) => events.push(e));
    parser.push(': stream-open\n\n\n: keep-alive\n\n');
    parser.flush();
    assert.equal(events.length, 0);
    assert.equal(parseJobEventData('<html>'), null);
    assert.equal(parseJobEventData('[1,2]'), null);
    assert.equal(parseJobEventData(''), null);
});

// ── Job state ────────────────────────────────────────────────────────────────
test('status vocabulary', () => {
    assert.equal(normalizeJobStatus('crawling'), 'running');
    assert.equal(normalizeJobStatus('extracting'), 'running');
    assert.equal(normalizeJobStatus('connecting'), 'running');
    assert.equal(normalizeJobStatus('completed'), 'completed');
    assert.equal(normalizeJobStatus('failed'), 'failed');
    assert.equal(normalizeJobStatus(undefined), null);
    assert.equal(isTerminalJobStatus('running'), false);
    assert.equal(isTerminalJobStatus('failed'), true);
});

test('only a completed event completes the job; running events never do', () => {
    let s = jobReducer(createJobState({ stages: STAGES }), ev({ stage: 1, status: 'running', progress: 10, message: 'Connecting…' }));
    s = jobReducer(s, ev({ stage: 7, status: 'running', progress: 85 }));
    assert.equal(s.status, 'running');
    assert.equal(s.progress, 85);
    s = jobReducer(s, ev({ stage: 9, status: 'completed', progress: 100, message: 'Done', capsules: [{ id: 1, name: 'Acme', type: 'company' }, { id: 2, name: 'Widget', type: 'product' }], knowledge_merge: { superseded_capsule_ids: [5], preserved_capsule_ids: [] } }));
    assert.equal(s.status, 'completed');
    assert.equal(s.progress, 100);
    assert.equal(s.capsulesKnown, true);
    assert.deepEqual(summarizeCapsules(s.capsules), { total: 2, company: 1, products: 1, names: ['Acme', 'Widget'] });
    assert.deepEqual(s.merge, { superseded: 1, preserved: 0 });
    assert.equal(s.endedAt, 1000);
});

test('progress and stage never move backwards while running (crawler events restart at 10%)', () => {
    let s = createJobState();
    s = jobReducer(s, ev({ stage: 2, status: 'running', progress: 20 }));
    s = jobReducer(s, ev({ stage: 2, status: 'crawling', progress: 10, pages_discovered: 6, pages_processed: 0, current_url: 'https://x.com/about' }));
    assert.equal(s.progress, 20);
    assert.equal(s.pagesDiscovered, 6);
    assert.equal(s.currentUrl, 'https://x.com/about');
    s = jobReducer(s, ev({ stage: 1, status: 'running', progress: 5 }));
    assert.equal(s.stage, 2);
    assert.equal(s.progress, 20);
});

test('a failed event keeps its error and freezes; later events are ignored', () => {
    let s = jobReducer(createJobState(), ev({ stage: 2, status: 'running', progress: 20 }));
    s = jobReducer(s, ev({ stage: 2, status: 'failed', progress: 25, title: 'Website Crawl Blocked', error: 'Could not extract content from website (HTTP 403).' }));
    assert.equal(s.status, 'failed');
    assert.match(s.error, /HTTP 403/);
    assert.equal(s.cancelled, false);
    const after = jobReducer(s, ev({ stage: 9, status: 'completed', progress: 100 }));
    assert.equal(after, s);
    assert.equal(stageState(2, s), 'failed');
    assert.equal(stageState(1, s), 'done');
    assert.equal(stageState(3, s), 'pending');
});

test('cancelled jobs are failed with the cancellation flag', () => {
    const s = jobReducer(createJobState(), ev({ stage: -1, status: 'failed', progress: 0, cancelled: true, error: 'Ingestion was cancelled.' }));
    assert.equal(s.status, 'failed');
    assert.equal(s.cancelled, true);
    assert.equal(s.error, 'Ingestion was cancelled.');
});

test('a replay of the previous attempt\'s terminal event is ignored (re-sync reuses the job id)', () => {
    let s = createJobState({ staleStamp: '2026-11-11T10:00:00.000001' });
    s = jobReducer(s, ev({ status: 'failed', error: 'old failure', timestamp: '2026-11-11T10:00:00.000001' }));
    assert.equal(s.status, 'running');
    s = jobReducer(s, ev({ stage: 1, status: 'running', progress: 10, timestamp: '2026-11-11T10:05:00' }));
    assert.equal(s.lastStamp, '2026-11-11T10:05:00');
    s = jobReducer(s, ev({ status: 'failed', error: 'new failure', timestamp: '2026-11-11T10:06:00' }));
    assert.equal(s.error, 'new failure');
});

test('connection loss is tracked separately and cleared by the next event', () => {
    let s = jobReducer(createJobState(), { type: 'connection-lost', error: 'offline' });
    assert.equal(s.status, 'running');
    assert.equal(s.connectionError, 'offline');
    s = jobReducer(s, { type: 'live-mode', mode: 'polling' });
    assert.equal(s.liveMode, 'polling');
    s = jobReducer(s, ev({ stage: 3, status: 'running', progress: 40 }));
    assert.equal(s.connectionError, null);
    assert.equal(jobReducer(s, { type: 'reconnect' }).liveMode, 'stream');
});

test('document imports skip website discovery; the checklist reflects the current stage', () => {
    const docs = stageListForJob(STAGES, 'document');
    assert.deepEqual(docs.map((d) => d.stage), [1, 3, 9]);
    assert.equal(docs[0].title, 'Reading your documents');
    assert.deepEqual(stageListForJob(STAGES, 'website').map((d) => d.stage), [1, 2, 3, 9]);
    const s = jobReducer(createJobState(), ev({ stage: 3, status: 'running', progress: 40 }));
    assert.deepEqual([1, 2, 3, 9].map((n) => stageState(n, s)), ['done', 'done', 'active', 'pending']);
    assert.equal(stageState(1, createJobState()), 'active');
});

// ── Watching a job ───────────────────────────────────────────────────────────
const enc = new TextEncoder();

function streamOf(chunks, signal, { hang = false } = {}) {
    let i = 0;
    return {
        body: {
            getReader() {
                return {
                    read() {
                        if (i < chunks.length) return Promise.resolve({ value: enc.encode(chunks[i++]), done: false });
                        if (!hang) return Promise.resolve({ value: undefined, done: true });
                        return new Promise((_, reject) => {
                            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
                        });
                    },
                    cancel: () => Promise.resolve(),
                };
            },
        },
    };
}

function watch(options) {
    const events = [];
    const modes = [];
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('watcher did not finish')), 3000);
        const done = (result) => { clearTimeout(timer); resolve({ events, modes, ...result }); };
        watchKnowledgeJob({
            jobId: 'job-1',
            pollIntervalMs: 1,
            onLiveModeChange: (m) => modes.push(m),
            onConnectionLost: (message) => done({ lost: message }),
            onEvent: (d) => {
                events.push(d);
                const stale = Boolean(options.staleStamp) && d.timestamp === options.staleStamp;
                if (isTerminalJobStatus(d.status) && !stale) setTimeout(() => done({}), 5);
            },
            ...options,
        });
    });
}

test('watcher: SSE stream with split frames is followed to the terminal event without polling', async () => {
    let polled = 0;
    const r = await watch({
        openStream: (_id, signal) => Promise.resolve(streamOf([
            'data: {"stage":1,"status":"running","progress":10}\n\nda',
            'ta: {"stage":3,"status":"running","progress":40}\n',
            '\n: ping\n\ndata: {"stage":9,"status":"completed","progress":100,"capsules":[]}\n\n',
        ], signal)),
        fetchSnapshot: () => { polled += 1; return Promise.resolve({ status: 'running' }); },
    });
    assert.deepEqual(r.events.map((e) => e.progress), [10, 40, 100]);
    assert.equal(polled, 0);
    assert.deepEqual(r.modes, []);
});

test('watcher: a broken stream falls back to polling until the job completes', async () => {
    const snapshots = [{ status: 'extracting', progress: 50 }, { status: 'completed', progress: 100 }];
    const r = await watch({
        openStream: () => Promise.reject(new ApiError('Server error (502). Please retry.', { status: 502 })),
        fetchSnapshot: () => Promise.resolve(snapshots.shift()),
    });
    assert.deepEqual(r.modes, ['polling']);
    assert.deepEqual(r.events.map((e) => e.status), ['extracting', 'completed']);
});

test('watcher: a stream that ends without a terminal event is followed up by polling', async () => {
    const r = await watch({
        openStream: (_id, signal) => Promise.resolve(streamOf(['data: {"stage":2,"status":"crawling","progress":12}\n\n'], signal)),
        fetchSnapshot: () => Promise.resolve({ status: 'failed', error: 'Blocked' }),
    });
    assert.deepEqual(r.modes, ['polling']);
    assert.equal(r.events.at(-1).error, 'Blocked');
});

test('watcher: an expired session stops it with the session message (no polling)', async () => {
    let polled = 0;
    const r = await watch({
        openStream: () => Promise.reject(new ApiError(SESSION_EXPIRED_MESSAGE, { status: 401 })),
        fetchSnapshot: () => { polled += 1; return Promise.resolve({}); },
    });
    assert.equal(r.lost, SESSION_EXPIRED_MESSAGE);
    assert.equal(polled, 0);
});

test('watcher: repeated poll failures report a lost connection; 404 means the job is gone', async () => {
    let calls = 0;
    const r = await watch({
        maxPollFailures: 3,
        openStream: () => Promise.reject(new Error('network')),
        fetchSnapshot: () => { calls += 1; return Promise.reject(new ApiError('Could not reach the server.', { status: 0 })); },
    });
    assert.equal(calls, 3);
    assert.equal(r.lost, 'Could not reach the server.');
    const gone = await watch({
        openStream: () => Promise.reject(new Error('network')),
        fetchSnapshot: () => Promise.reject(new ApiError('The requested item was not found.', { status: 404 })),
    });
    assert.equal(gone.lost, JOB_NOT_FOUND_MESSAGE);
});

test('watcher: the previous attempt\'s terminal snapshot is skipped until fresh events arrive', async () => {
    const stale = '2026-11-11T10:00:00';
    const snapshots = [
        { status: 'failed', error: 'old', timestamp: stale },
        { status: 'failed', error: 'old', timestamp: stale },
        { stage: 1, status: 'running', progress: 10, timestamp: '2026-11-11T10:01:00' },
        { stage: 9, status: 'completed', progress: 100, timestamp: '2026-11-11T10:02:00' },
    ];
    const r = await watch({
        staleStamp: stale,
        openStream: (_id, signal) => Promise.resolve(streamOf([`data: {"status":"failed","error":"old","timestamp":"${stale}"}\n\n`], signal)),
        fetchSnapshot: () => Promise.resolve(snapshots.shift()),
    });
    assert.equal(r.events.at(-1).status, 'completed');
});

test('watcher: a silent stream trips the watchdog and polling takes over', async () => {
    const r = await watch({
        watchdogMs: 30,
        openStream: (_id, signal) => Promise.resolve(streamOf([], signal, { hang: true })),
        fetchSnapshot: () => Promise.resolve({ status: 'completed', progress: 100 }),
    });
    assert.deepEqual(r.modes, ['polling']);
    assert.equal(r.events.at(-1).status, 'completed');
});

test('watcher: stop() ends everything without callbacks', async () => {
    let lost = false;
    let events = 0;
    const w = watchKnowledgeJob({
        jobId: 'j',
        openStream: (_id, signal) => Promise.resolve(streamOf([], signal, { hang: true })),
        fetchSnapshot: () => Promise.resolve({ status: 'running' }),
        onEvent: () => { events += 1; },
        onConnectionLost: () => { lost = true; },
    });
    w.stop();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(lost, false);
    assert.equal(events, 0);
});

// ── View helpers ─────────────────────────────────────────────────────────────
const file = (name, size = 1000) => ({ name, size });

test('upload validation mirrors the server limits', () => {
    assert.equal(validateKnowledgeFiles([file('a.pdf'), file('b.HTML'), file('c.markdown')]).ok, true);
    assert.match(validateKnowledgeFiles([]).error, /at least one/);
    assert.match(validateKnowledgeFiles(Array.from({ length: 11 }, (_, i) => file(`f${i}.txt`))).error, /at most 10/);
    assert.match(validateKnowledgeFiles([file('old.doc')]).error, /Save it as \.docx/);
    assert.match(validateKnowledgeFiles([file('tool.exe')]).error, /Unsupported file tool\.exe/);
    assert.match(validateKnowledgeFiles([file('empty.txt', 0)]).error, /empty/);
    assert.match(validateKnowledgeFiles([file('big.pdf', 21 * 1024 * 1024)]).error, /20 MB/);
    assert.match(validateKnowledgeFiles(Array.from({ length: 6 }, (_, i) => file(`p${i}.pdf`, 19 * 1024 * 1024))).error, /100 MB/);
    assert.ok(KNOWLEDGE_UPLOAD_ACCEPT.includes('.htm') && !KNOWLEDGE_UPLOAD_ACCEPT.includes('.doc,'));
});

test('website input', () => {
    assert.deepEqual(normalizeWebsiteInput('example.com/about'), { url: 'https://example.com/about', domain: 'example.com', error: null });
    assert.equal(normalizeWebsiteInput('http://shop.example.in').url, 'http://shop.example.in');
    assert.ok(normalizeWebsiteInput('').error);
    assert.ok(normalizeWebsiteInput('my site.com').error);
    assert.ok(normalizeWebsiteInput('ftp://example.com').error);
});

test('status labels come from the records', () => {
    assert.equal(capsuleStatusMeta('draft').label, 'Draft');
    assert.equal(capsuleStatusMeta('published').label, 'Published');
    assert.equal(capsuleStatusMeta(undefined).label, 'Draft');
    assert.equal(sourceStatusMeta('failed').failed, true);
    assert.equal(sourceStatusMeta('crawling').running, true);
    assert.equal(sourceStatusMeta('completed').label, 'Ready');
    assert.equal(factOriginMeta('user_confirmed').label, 'User confirmed');
    assert.equal(factOriginMeta('observed_fact').label, 'Observed Fact');
    assert.equal(factOriginMeta('ai_inference').label, 'AI Inference');
    assert.equal(approvalMeta('approved').next, 'rejected');
    assert.equal(approvalMeta('rejected').label, 'Rejected');
});

test("failed sources show the server's error_message; cancelled and interrupted imports are told apart", () => {
    const failed = sourceFailure({ type: 'website', status: 'failed', error_message: 'Security check failed: private address' });
    assert.deepEqual(failed, {
        cancelled: false, label: 'Failed', hint: 'This import failed. Re-sync to try again, or delete it.',
        detail: 'Security check failed: private address',
    });
    // POST /jobs/{id}/cancel keeps the source as failed with "Import cancelled."
    const cancelled = sourceFailure({ type: 'document', status: 'failed', error_message: 'Import cancelled.' });
    assert.deepEqual(cancelled, {
        cancelled: true, label: 'Cancelled', hint: 'This import was cancelled. Upload the files again, or delete it.', detail: '',
    });
    // an import abandoned by a server restart now comes back failed with a reason
    const interrupted = sourceFailure({
        type: 'website', status: 'failed',
        error_message: 'Import interrupted: the server restarted before it finished. Start the import again.',
    });
    assert.equal(interrupted.cancelled, false);
    assert.match(interrupted.detail, /^Import interrupted: the server restarted/);
    // no stored reason (older rows): the hint alone
    assert.equal(sourceFailure({ type: 'website', status: 'failed', error_message: null }).detail, '');
    assert.equal(sourceFailure({ type: 'website', status: 'completed', error_message: null }), null);
    assert.equal(sourceFailure({ type: 'website', status: 'crawling' }), null);
    assert.equal(sourceFailure(null), null);
});

test('cancelling an import keeps its source (never "deleted")', () => {
    for (const kind of ['website', 'document']) {
        const text = cancelImportOutcome(kind);
        assert.match(text, /source stays under Connected Sources as cancelled/);
        assert.doesNotMatch(text, /delet(ed|es) (the|this) source/i);
    }
    assert.match(cancelImportOutcome('website'), /re-sync it to try again/);
    assert.match(cancelImportOutcome('document'), /upload the files again to retry/);
});

test('links: only http(s) URLs are links; document:// names are extracted', () => {
    assert.equal(isHttpUrl('https://x.com/p'), true);
    assert.equal(isHttpUrl('document://Pricing.pdf'), false);
    assert.equal(documentName('document://Pricing.pdf'), 'Pricing.pdf');
    assert.equal(documentName('https://x.com'), '');
});

test('capsules created from a source (by source id, or by exact URL for older capsules)', () => {
    const overview = {
        company_capsule: { id: 1, company_name: 'Acme', intelligence_data: { source_id: 's1' } },
        product_capsules: [
            { id: 2, product_name: 'Widget', intelligence_data: { source_id: 's1' } },
            { id: 3, product_name: 'Gadget', intelligence_data: { source_id: 's2' } },
            { id: 4, product_name: 'Legacy', intelligence_data: { source_url: 'https://acme.com' } },
            { id: 5, name: 'Manual', intelligence_data: null },
        ],
    };
    assert.deepEqual(capsulesFromSource(overview, { id: 's1', type: 'website', url: 'https://acme.com' }).map((c) => c.id), [1, 2, 4]);
    assert.deepEqual(capsulesFromSource(overview, { id: 's2', type: 'website', url: 'https://other.com' }).map((c) => c.id), [3]);
    assert.deepEqual(capsulesFromSource(overview, { id: 's9', type: 'document', title: 'a.pdf, b.pdf' }), []);
});

test('typed confirmation phrases', () => {
    assert.equal(confirmPhraseForSource({ type: 'website', url: 'https://www.acme.com/about', title: 'www.acme.com' }), 'www.acme.com');
    assert.equal(confirmPhraseForSource({ type: 'document', title: 'Pricing.pdf, Deck.pdf' }), 'Pricing.pdf');
    assert.equal(phraseMatches('  ACME.com ', 'acme.com'), true);
    assert.equal(phraseMatches('acme', 'acme.com'), false);
    assert.equal(phraseMatches('', ''), false);
});

test('local overview patches and empty detection', () => {
    const overview = { stats: { total_capsules: 0, total_sources: 0 }, facts: [{ id: 'f1', value: 'a' }], company_capsule: { id: 1, version: 1 }, product_capsules: [{ id: 2, version: 3 }] };
    assert.equal(patchFact(overview, 'f1', { value: 'b', inference_type: 'user_confirmed' }).facts[0].inference_type, 'user_confirmed');
    const published = patchCapsule(overview, 2, { version: 4, status: 'published' });
    assert.equal(published.product_capsules[0].version, 4);
    assert.equal(published.company_capsule.version, 1);
    assert.equal(patchCapsule(overview, 1, { version: undefined }).company_capsule.version, 1);
    assert.equal(hasKnowledge(overview), false);
    assert.equal(hasKnowledge({ stats: { total_sources: 1 } }), true);
});

test('request copy and target labels for websites and documents', () => {
    assert.match(describeImportRequest({ kind: 'document', fileNames: ['a.pdf', 'b.docx'] }), /^Read 2 uploaded documents \(a\.pdf, b\.docx\)/);
    assert.doesNotMatch(describeImportRequest({ kind: 'document', fileNames: ['a.pdf'] }), /https:\/\//);
    assert.match(describeImportRequest({ kind: 'website', url: 'https://acme.com' }), /^Read https:\/\/acme\.com/);
    assert.equal(importTargetLabel({ kind: 'document', fileNames: ['a.pdf', 'b.pdf'] }), '2 documents');
    assert.equal(importTargetLabel({ kind: 'website', url: 'https://acme.com/x' }), 'acme.com');
});
