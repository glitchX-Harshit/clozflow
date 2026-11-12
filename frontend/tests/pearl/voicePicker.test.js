import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOZFLOW_VOICE_LIST } from '../../src/components/voiceList.js';
import {
    filterVoices,
    findActiveVoice,
    moveActiveIndex,
    voicePreviewPath,
    voiceSearchPlaceholder,
} from '../../src/pages/pearl/lib/voicePicker.js';

test('the placeholder counts the real catalogue', () => {
    assert.equal(voiceSearchPlaceholder(CLOZFLOW_VOICE_LIST.length), `Search ${CLOZFLOW_VOICE_LIST.length} voices by name, accent, style...`);
    assert.ok(!voiceSearchPlaceholder(CLOZFLOW_VOICE_LIST.length).includes('224') || CLOZFLOW_VOICE_LIST.length === 224);
});

test('Kavya is listed as Female, matching the backend speaker registry', () => {
    const kavya = CLOZFLOW_VOICE_LIST.find((v) => v.id === 'kavya_hi_conversational');
    assert.equal(kavya.gender, 'Female');
});

test('active voice resolves by id, id prefix and name, else the first voice', () => {
    assert.equal(findActiveVoice(CLOZFLOW_VOICE_LIST, 'kavya_hi_conversational').id, 'kavya_hi_conversational');
    assert.equal(findActiveVoice(CLOZFLOW_VOICE_LIST, 'KAVYA_HI_CONVERSATIONAL').id, 'kavya_hi_conversational');
    assert.equal(findActiveVoice(CLOZFLOW_VOICE_LIST, 'kavya').id.startsWith('kavya_'), true);
    assert.equal(findActiveVoice(CLOZFLOW_VOICE_LIST, '').id, CLOZFLOW_VOICE_LIST[0].id);
    assert.equal(findActiveVoice(CLOZFLOW_VOICE_LIST, 'nobody').id, CLOZFLOW_VOICE_LIST[0].id);
    assert.equal(findActiveVoice([], 'x'), null);
});

test('filters and search', () => {
    const female = filterVoices(CLOZFLOW_VOICE_LIST, { filter: 'female' });
    assert.ok(female.length > 0 && female.every((v) => v.gender === 'Female'));
    const odia = filterVoices(CLOZFLOW_VOICE_LIST, { filter: 'odia' });
    assert.ok(odia.length > 0 && odia.every((v) => v.language === 'Odia'));
    const regional = filterVoices(CLOZFLOW_VOICE_LIST, { filter: 'regional' });
    assert.ok(regional.every((v) => !['Hindi', 'Hinglish', 'Indian English'].includes(v.language)));
    assert.deepEqual(filterVoices(CLOZFLOW_VOICE_LIST, { search: 'kavya' }).map((v) => v.id), ['kavya_hi_conversational']);
    assert.equal(filterVoices(CLOZFLOW_VOICE_LIST, { search: 'zzzz-no-voice' }).length, 0);
    assert.equal(filterVoices(CLOZFLOW_VOICE_LIST, {}).length, CLOZFLOW_VOICE_LIST.length);
});

test('preview path is encoded (the API base is added by apiUrl)', () => {
    assert.equal(voicePreviewPath('shubh_enhi_ads'), '/api/pearl/voice-preview/shubh_enhi_ads');
    assert.equal(voicePreviewPath('a/b'), '/api/pearl/voice-preview/a%2Fb');
});

test('keyboard navigation is clamped', () => {
    assert.equal(moveActiveIndex(-1, 'ArrowDown', 5), 0);
    assert.equal(moveActiveIndex(4, 'ArrowDown', 5), 4);
    assert.equal(moveActiveIndex(-1, 'ArrowUp', 5), 4);
    assert.equal(moveActiveIndex(0, 'ArrowUp', 5), 0);
    assert.equal(moveActiveIndex(2, 'Home', 5), 0);
    assert.equal(moveActiveIndex(2, 'End', 5), 4);
    assert.equal(moveActiveIndex(1, 'PageDown', 20), 9);
    assert.equal(moveActiveIndex(3, 'ArrowDown', 0), -1);
    assert.equal(moveActiveIndex(9, 'ArrowDown', 5), 0);
});
