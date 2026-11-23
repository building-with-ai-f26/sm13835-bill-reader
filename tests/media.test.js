// Run with: node --test
// These check the code that decides whether a statement pulled from a TV transcript can be trusted.
const test = require('node:test');
const assert = require('node:assert');
const { verifyStatements, dedupe, splitOfficial, officialCheck, seconds } = require('../app/media.js');

const transcript = {
  turns: [
    { t: '00:00', speaker: 'HOST', text: 'Will you vote for the bill if the SALT cap stays?' },
    { t: '00:12', speaker: 'GOTTHEIMER', text: 'No. I will not vote for any bill that does not fully restore the SALT deduction, uh, period.' },
    { t: '01:05', speaker: 'OTHER', name: 'Rep. Brian Fitzpatrick', text: 'We will do whatever it takes to keep the government open.' },
  ],
};
const good = { turn: 1, quote: 'I will not vote for any bill that does not fully restore the SALT deduction', kind: 'promise', topic: 'SALT', scope: 'any tax bill' };

test('keeps a promise quoted word for word from the member, with its timestamp', () => {
  const { verified, dropped } = verifyStatements([good], transcript);
  assert.strictEqual(verified.length, 1);
  assert.strictEqual(verified[0].timestamp, '00:12');
  assert.strictEqual(dropped.length, 0);
});

test('drops a quote that is reworded', () => {
  const { verified, dropped } = verifyStatements([{ ...good, quote: 'I will never support a bill without full SALT restoration' }], transcript);
  assert.strictEqual(verified.length, 0);
  assert.match(dropped[0].reason, /not found/);
});

test('drops words spoken by the host or another guest, even if the quote is exact', () => {
  const host = verifyStatements([{ ...good, turn: 0, quote: 'Will you vote for the bill if the SALT cap stays' }], transcript);
  const guest = verifyStatements([{ ...good, turn: 2, quote: 'We will do whatever it takes to keep the government open' }], transcript);
  assert.match(host.dropped[0].reason, /HOST/);
  assert.match(guest.dropped[0].reason, /OTHER/);
});

test('drops quotes that are too short, an unknown kind, or a turn that does not exist', () => {
  const { dropped } = verifyStatements([{ ...good, quote: 'No.' }, { ...good, kind: 'opinion' }, { ...good, turn: 9 }], transcript);
  assert.deepStrictEqual(dropped.map((d) => d.reason.split(' ')[0]), ['quote', 'unknown', 'turn']);
});

test('ignores curly quotes, dashes and spacing differences', () => {
  const t = { turns: [{ t: '00:01', speaker: 'GOTTHEIMER', text: 'We’ll fight — every   day — for lower taxes in New Jersey.' }] };
  const { verified } = verifyStatements([{ ...good, turn: 0, quote: "We'll fight every day for lower taxes in New Jersey" }], t);
  assert.strictEqual(verified.length, 1);
});

test('removes the same quote seen in two uploads, keeping the first and noting the other', () => {
  const a = { quote: 'I will not vote for any bill that does not restore SALT', appearance_id: 'a' };
  const b = { quote: 'I will not vote for any bill that does not restore SALT', appearance_id: 'b' };
  const kept = dedupe([a, b]);
  assert.strictEqual(kept.length, 1);
  assert.deepStrictEqual(kept[0].also_in, ['b']);
});

test('the official transcript confirms the member, or flags words credited to someone else', () => {
  const html = '<p>MARGARET BRENNAN: Welcome.</p><p>REP. GOTTHEIMER: I will not vote for any bill that does not fully restore the SALT deduction.</p>'
    + '<p>REP. FITZPATRICK: We will do whatever it takes to keep the government open, we made that pledge.</p>';
  const official = splitOfficial(html, 'Gottheimer');
  assert.strictEqual(officialCheck(good.quote, official), 'confirmed');
  assert.strictEqual(officialCheck('We will do whatever it takes to keep the government open', official), 'conflict');
  assert.strictEqual(officialCheck('Something he never said on this program at all today', official), 'not_found');
  assert.strictEqual(officialCheck(good.quote, null), null);
});

test('turns transcript timestamps into seconds for YouTube links', () => {
  assert.strictEqual(seconds('02:54'), 174);
  assert.strictEqual(seconds('1:02:03'), 3723);
  assert.strictEqual(seconds('bad'), 0);
});
