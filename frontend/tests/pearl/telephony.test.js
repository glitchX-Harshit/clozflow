import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    BYOC_CARRIERS, OTHER_CARRIER_ID, SUPPORT_EMAIL, buildByocRequest, carrierNamesText, validateByocRequest,
} from '../../src/pages/pearl/lib/telephonyCarriers.js';
import { creditRuleText, formatRupees, pricingRows } from '../../src/pages/pearl/lib/telephonyRates.js';

test('the BYOC catalogue only lists carriers the Pearl dialer can use', () => {
    assert.deepEqual(BYOC_CARRIERS.map((c) => c.id), ['exotel', 'vobiz']);
    assert.equal(carrierNamesText(), 'Exotel and Vobiz');
    assert.equal(carrierNamesText([{ name: 'A' }, { name: 'B' }, { name: 'C' }]), 'A, B and C');
});

test('request validation needs a carrier and a reply address', () => {
    assert.deepEqual(Object.keys(validateByocRequest({})).sort(), ['carrierId', 'contactEmail']);
    assert.ok(validateByocRequest({ carrierId: OTHER_CARRIER_ID, contactEmail: 'a@b.co' }).otherCarrierName);
    assert.deepEqual(validateByocRequest({ carrierId: 'vobiz', contactEmail: ' a@b.co ' }), {});
    assert.ok(validateByocRequest({ carrierId: 'vobiz', contactEmail: 'not-an-email' }).contactEmail);
});

test('the request e-mail carries the details and no secrets', () => {
    const req = buildByocRequest({
        carrierId: 'exotel', orgName: "Asha's Organisation", contactEmail: 'asha@x.com', monthlyMinutes: '5000', notes: 'Two DIDs',
    });
    assert.equal(req.carrier, 'Exotel');
    assert.match(req.subject, /Exotel/);
    assert.match(req.body, /Organisation: Asha's Organisation/);
    assert.match(req.body, /Expected call minutes per month: 5000/);
    assert.doesNotMatch(req.body, /Phone numbers I want to use/); // empty optional fields are left out
    assert.match(req.body, /No credentials are included/);
    assert.ok(req.mailto.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`));
    assert.ok(req.mailto.includes('%0D%0A'));
    const other = buildByocRequest({ carrierId: OTHER_CARRIER_ID, otherCarrierName: ' Tata Smartflo ' });
    assert.equal(other.carrier, 'Tata Smartflo');
});

test('pricing rows come from the server rates; missing rates are dropped', () => {
    const balance = {
        conversion_rule: '1 INR = 1 Credit',
        phone_rental_available: false,
        rates: { test_simulation: 2, pearl_call_per_minute: 3, telephony_pulse_30s: 0.25, phone_rental_monthly: 179 },
    };
    const rows = pricingRows(balance);
    assert.deepEqual(rows.map((r) => r.key), ['pearl_call_per_minute', 'telephony_pulse_30s', 'test_simulation', 'phone_rental_monthly']);
    assert.equal(rows[0].value, '₹3.00 / minute');
    assert.equal(rows[3].value, '₹179.00 / month');
    assert.match(rows[3].note, /Not available yet/);
    assert.equal(pricingRows({ rates: { pearl_call_per_minute: 4.5 } }).length, 1);
    assert.equal(pricingRows({ rates: { pearl_call_per_minute: 'x', test_simulation: null } }).length, 0);
    assert.deepEqual(pricingRows(null), []);
    assert.equal(creditRuleText(balance), '1 INR = 1 Credit');
    assert.equal(formatRupees(2), '₹2.00');
    assert.equal(formatRupees(''), '');
});

test('a changed server rate changes the modal value with no frontend change', () => {
    assert.equal(pricingRows({ rates: { pearl_call_per_minute: 3.75 } })[0].value, '₹3.75 / minute');
});
