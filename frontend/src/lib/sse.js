/**
 * Incremental Server-Sent Events parser.
 *
 * Network reads can end anywhere — between "event:" and "data:", inside the JSON,
 * or between "\r" and "\n". The parser keeps the partial line, the pending event
 * type and the data lines across pushes, and dispatches only on a blank line.
 *
 *   const parser = createSseParser(({ type, data }) => …);
 *   parser.push(decoder.decode(chunk, { stream: true }));
 *   …
 *   parser.push(decoder.decode()); parser.flush();
 */
export function createSseParser(onEvent) {
    let buffer = '';
    let eventType = '';
    let dataLines = [];

    const dispatch = () => {
        if (dataLines.length === 0) {
            eventType = '';
            return;
        }
        const event = { type: eventType || 'message', data: dataLines.join('\n') };
        eventType = '';
        dataLines = [];
        onEvent(event);
    };

    const processLine = (line) => {
        if (line === '') {
            dispatch();
            return;
        }
        if (line.startsWith(':')) return; // comment / keep-alive
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') eventType = value;
        else if (field === 'data') dataLines.push(value);
        // `id` and `retry` are not used by the lead search stream.
    };

    const drain = (final) => {
        let start = 0;
        for (let i = 0; i < buffer.length; i++) {
            const ch = buffer[i];
            if (ch !== '\n' && ch !== '\r') continue;
            // A trailing "\r" may be the first half of "\r\n" split across reads.
            if (ch === '\r' && i === buffer.length - 1 && !final) break;
            processLine(buffer.slice(start, i));
            if (ch === '\r' && buffer[i + 1] === '\n') i += 1;
            start = i + 1;
        }
        buffer = buffer.slice(start);
    };

    return {
        push(text) {
            if (!text) return;
            buffer += text;
            drain(false);
        },
        /** End of stream: process any unterminated line and pending event. */
        flush() {
            drain(true);
            if (buffer) {
                processLine(buffer);
                buffer = '';
            }
            dispatch();
        },
    };
}

/** JSON-decode an event's data; returns `undefined` when it is not valid JSON. */
export function parseEventData(event) {
    try {
        return JSON.parse(event.data);
    } catch {
        return undefined;
    }
}
