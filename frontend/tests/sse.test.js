import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser, parseEventData } from '../src/lib/sse.js';

const collect = () => {
    const events = [];
    const parser = createSseParser((e) => events.push(e));
    return { events, parser };
};

const STREAM = [
    'event: searching\ndata: {"area":"Kothrud","area_index":1,"total_areas":9}\n\n',
    'event: lead_found\ndata: {"business_name":"Cafe Mocha","city":"Pune"}\n\n',
    'event: complete\ndata: {"total_leads":1,"leads":[{"business_name":"Cafe Mocha"}]}\n\n',
].join('');

test('an event split between "event:" and the rest of "data:" is not lost', () => {
    const { events, parser } = collect();
    parser.push('event: complete\ndata: {"a":');
    assert.equal(events.length, 0);
    parser.push('1}\n\n');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'complete');
    assert.deepEqual(parseEventData(events[0]), { a: 1 });
});

test('feeding the stream one character at a time yields the same events as feeding it whole', () => {
    const whole = collect();
    whole.parser.push(STREAM);
    whole.parser.flush();

    const chars = collect();
    for (const ch of STREAM) chars.parser.push(ch);
    chars.parser.flush();

    assert.equal(whole.events.length, 3);
    assert.deepEqual(chars.events, whole.events);
    assert.deepEqual(whole.events.map((e) => e.type), ['searching', 'lead_found', 'complete']);
});

test('CRLF line endings, including a CR/LF pair split across reads', () => {
    const { events, parser } = collect();
    parser.push('event: lead_found\r');
    parser.push('\ndata: {"x":1}\r\n\r');
    parser.push('\n');
    assert.equal(events.length, 1);
    assert.deepEqual(parseEventData(events[0]), { x: 1 });
});

test('multi-line data, missing space after the colon, comments and default type', () => {
    const { events, parser } = collect();
    parser.push(': keep-alive\n\ndata:{"a":\ndata: 2}\n\nevent:area_done\ndata:{"total_leads":3}\n\n');
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'message');
    assert.equal(events[0].data, '{"a":\n2}');
    assert.deepEqual(parseEventData(events[0]), { a: 2 });
    assert.equal(events[1].type, 'area_done');
});

test('flush() dispatches a final event that has no trailing blank line', () => {
    const { events, parser } = collect();
    parser.push('event: complete\ndata: {"total_leads":0}');
    assert.equal(events.length, 0);
    parser.flush();
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'complete');
});

test('parseEventData returns undefined for invalid JSON', () => {
    assert.equal(parseEventData({ data: '{"broken' }), undefined);
});
