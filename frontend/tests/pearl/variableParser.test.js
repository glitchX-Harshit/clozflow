import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeVariablesWithDefaults, substituteVariables } from '../../src/utils/variableParser.js';

test('Object.prototype names are not variable values (FE-37)', () => {
    assert.equal(substituteVariables('{{constructor | "x"}}', {}), 'x');
    assert.equal(substituteVariables('{{toString}}', {}), '');
    assert.equal(substituteVariables('Hi {{constructor}} and {{toString}}', {}), 'Hi  and ');
    assert.equal(substituteVariables('{{hasOwnProperty | fallback}}', {}), 'fallback');
    assert.equal(substituteVariables('{{__proto__ | p}}', {}), 'p');
});

test('own values still substitute, including names that shadow prototype members', () => {
    assert.equal(substituteVariables('Hi {{constructor}}', { constructor: 'Builder' }), 'Hi Builder');
    assert.equal(substituteVariables('{{name}}', { name: 'Rahul' }), 'Rahul');
    assert.equal(substituteVariables('{{name | "Sir"}}', { name: '  ' }), 'Sir');
    assert.equal(substituteVariables('{{name}}', null), '');
    assert.equal(substituteVariables('{{trk}}', {}, { preserveUnmatched: true }), '{{trk}}');
});

test('merge fills detected variables that are only inherited, and keeps user values', () => {
    const merged = mergeVariablesWithDefaults(
        [{ name: 'constructor', fallback: 'c' }, { name: 'toString' }, { name: 'lead_name', fallback: 'Sir' }],
        { lead_name: 'Asha' },
        [{ name: 'toString', sampleValue: 'sample' }],
    );
    assert.equal(Object.prototype.hasOwnProperty.call(merged, 'constructor'), true);
    assert.equal(merged.constructor, 'c');
    assert.equal(merged.toString, 'sample');
    assert.equal(merged.lead_name, 'Asha');
});

test('merge can add a variable literally named __proto__ without touching the prototype', () => {
    const merged = mergeVariablesWithDefaults([{ name: '__proto__', fallback: 'p' }], {});
    assert.equal(Object.getPrototypeOf(merged), Object.prototype);
    assert.equal(Object.prototype.hasOwnProperty.call(merged, '__proto__'), true);
    assert.equal(JSON.stringify(merged), '{"__proto__":"p"}');
});
