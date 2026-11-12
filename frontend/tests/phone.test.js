import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    guessCountryCode,
    isValidWhatsAppNumber,
    normalizeWhatsAppNumber,
    whatsAppUrl,
} from '../src/lib/phone.js';

test('a London landline with its trunk 0 becomes +44 …', () => {
    assert.deepEqual(normalizeWhatsAppNumber({ phone_number: '020 7946 0958', city: 'London' }),
        { number: '+442079460958', guessed: false, code: '+44' });
});

test('the search query names the country when the lead does not', () => {
    const r = normalizeWhatsAppNumber({ phone_number: '020 7946 0958', city: 'Camden' }, 'dentists in London');
    assert.equal(r.number, '+442079460958');
    assert.equal(r.guessed, false);
});

test('no country signal → +91 is assumed and flagged as a guess', () => {
    const r = normalizeWhatsAppNumber({ phone_number: '98200 12345', city: 'Springfieldia' }, 'best bakeries');
    assert.deepEqual(r, { number: '+919820012345', guessed: true, code: '+91' });
});

test('Austin is the US; "near us" and "ca" are not', () => {
    assert.equal(guessCountryCode('dentists in Austin'), '+1');
    assert.equal(guessCountryCode('123 Main St, Springfield, TX 78701'), '+1');
    assert.equal(guessCountryCode('cafes near us'), null);
    assert.equal(guessCountryCode('ca'), null);
    assert.equal(guessCountryCode('Find gyms in Mumbai'), '+91');
    assert.equal(guessCountryCode('nice cafes in Pune'), '+91');
});

test('numbers that already carry a country code are kept', () => {
    assert.equal(normalizeWhatsAppNumber({ phone_number: '+1 (415) 555-1234' }).number, '+14155551234');
    assert.equal(normalizeWhatsAppNumber({ phone_number: '0044 20 7946 0958' }).number, '+442079460958');
    assert.equal(normalizeWhatsAppNumber({ phone_number: '919876543210' }).number, '+919876543210');
    assert.deepEqual(normalizeWhatsAppNumber({ phone_number: '' }), { number: '', guessed: false, code: null });
});

test('WhatsApp needs 8–15 digits and the URL encodes the message', () => {
    assert.equal(isValidWhatsAppNumber('+'), false);
    assert.equal(isValidWhatsAppNumber('+91 123'), false);
    assert.equal(isValidWhatsAppNumber('+919820012345'), true);
    assert.equal(isValidWhatsAppNumber('+1234567890123456'), false);
    assert.equal(whatsAppUrl('+91 98200 12345', 'Hi & bye'), 'https://api.whatsapp.com/send?phone=919820012345&text=Hi%20%26%20bye');
});
