// Run with: node --test
// These check the code that decides whether a model's citation can be trusted.
const test = require('node:test');
const assert = require('node:assert');
const {
  verifyItems,
  verifyAlerts,
  verifyOverview,
  verifyIssueTags,
  buildIssueIndex,
  withIssues,
  tagBatches,
} = require('../app/analyze.js');

const inputs = {
  sections: [{ id: '70120', text: 'The cap shall be increased to\n$40,000 for “taxable years” beginning in 2025.' }],
  facts: [{ key: 'median_property_tax' }],
};

const goodItem = {
  section_id: '70120',
  bill_quote: 'increased to $40,000 for "taxable years"',
  district_facts: ['median_property_tax'],
};

test('keeps an item whose citations are real, ignoring line breaks and curly quotes', () => {
  const { verified, dropped } = verifyItems([goodItem], inputs);
  assert.strictEqual(verified.length, 1);
  assert.strictEqual(dropped.length, 0);
});

test('drops an invented bill quote', () => {
  const item = { ...goodItem, bill_quote: 'the cap is repealed permanently for all filers' };
  const { verified, dropped } = verifyItems([item], inputs);
  assert.strictEqual(verified.length, 0);
  assert.match(dropped[0].reason, /quote not found/);
});

test('drops a section that does not exist', () => {
  const { verified } = verifyItems([{ ...goodItem, section_id: '99999' }], inputs);
  assert.strictEqual(verified.length, 0);
});

test('drops an item with no real district fact behind it', () => {
  const { verified, dropped } = verifyItems([{ ...goodItem, district_facts: ['made_up_stat'] }], inputs);
  assert.strictEqual(verified.length, 0);
  assert.match(dropped[0].reason, /district fact/);
});

const alertInputs = {
  items: [{ section_id: '70120' }],
  promises: [
    { id: 'pledge', strength: 'Explicit vote pledge' },
    { id: 'other-bill', strength: 'Explicit vote pledge', other_bill: true },
    { id: 'position', strength: 'Stated position' },
  ],
};
const verdict = (promise_id, value = 'direct') => ({
  promise_id,
  verdict: value,
  explanation: 'x',
  section_ids: ['70120'],
});

test('an explicit pledge can be a direct conflict', () => {
  const { alerts } = verifyAlerts([verdict('pledge')], alertInputs);
  assert.strictEqual(alerts[0].severity, 'direct');
});

test('a general position is downgraded to possible, whatever the model said', () => {
  const { alerts } = verifyAlerts([verdict('position')], alertInputs);
  assert.strictEqual(alerts[0].severity, 'possible');
});

test('a pledge about a different bill is downgraded to possible', () => {
  const { alerts } = verifyAlerts([verdict('other-bill')], alertInputs);
  assert.strictEqual(alerts[0].severity, 'possible');
});

test('a verdict of none produces no alert', () => {
  const { alerts, dropped } = verifyAlerts([verdict('pledge', 'none')], alertInputs);
  assert.strictEqual(alerts.length, 0);
  assert.strictEqual(dropped.length, 0);
});

test('drops an alert for a promise we do not have', () => {
  const { alerts, dropped } = verifyAlerts([verdict('invented')], alertInputs);
  assert.strictEqual(alerts.length, 0);
  assert.match(dropped[0].reason, /does not exist/);
});

const overviewInputs = { items: [{ section_id: '70120' }], pages: { 70120: 98, 71119: 235 } };

test('a summary bullet links to the page of each real section', () => {
  const overview = { what_it_does: [{ text: 'x', section_ids: ['70120'] }] };
  const result = verifyOverview(overview, overviewInputs);
  assert.deepStrictEqual(result.what_it_does[0].sources, [{ section_id: '70120', page: 98 }]);
});

test('removes a section reference that was not analyzed, but keeps the bullet', () => {
  const overview = { what_it_does: [{ text: 'x', section_ids: ['70120', '71119', '99999'] }] };
  const result = verifyOverview(overview, overviewInputs);
  assert.strictEqual(result.what_it_does[0].sources.length, 1);
});

test('does not show a summary bullet with no real source', () => {
  const overview = { what_it_does: [{ text: 'x', section_ids: ['99999'] }] };
  const result = verifyOverview(overview, overviewInputs);
  assert.strictEqual(result.what_it_does.length, 0);
  assert.strictEqual(result.dropped_bullets, 1);
});

test('drops an alert that cites no analyzed section', () => {
  const unanalyzed = { ...verdict('pledge'), section_ids: ['99999'] };
  const { alerts, dropped } = verifyAlerts([unanalyzed], alertInputs);
  assert.strictEqual(alerts.length, 0);
  assert.match(dropped[0].reason, /no analyzed section/);
});

const tagSections = [
  { id: '1', header: 'One' },
  { id: '2', header: 'Two' },
  { id: '3', header: 'Three' },
];

test('removes an issue name that is not on the list and reports it', () => {
  const tags = [{ id: '1', issues: ['Tax', 'Space Pirates'] }];
  const result = verifyIssueTags(tags, tagSections);
  assert.deepStrictEqual(result.bySection['1'], ['Tax']);
  assert.deepStrictEqual(result.unknown_labels, ['Space Pirates']);
});

test('a section with no valid issue goes to Other', () => {
  const { bySection } = verifyIssueTags([{ id: '1', issues: ['Space Pirates'] }], tagSections);
  assert.deepStrictEqual(bySection['1'], ['Other']);
});

test('allows at most three issues per section, and drops Other when a real issue exists', () => {
  const tags = [{ id: '1', issues: ['Other', 'Tax', 'Tax', 'Energy', 'Housing', 'Trade'] }];
  const { bySection } = verifyIssueTags(tags, tagSections);
  assert.deepStrictEqual(bySection['1'], ['Tax', 'Energy', 'Housing']);
});

test('reports a section the model skipped and ignores one that does not exist', () => {
  const tags = [{ id: '1', issues: ['Tax'] }, { id: '99', issues: ['Tax'] }];
  const { bySection, untagged } = verifyIssueTags(tags, tagSections);
  assert.strictEqual(bySection['99'], undefined);
  assert.deepStrictEqual(untagged, ['2', '3']);
});

test('only issues found in the bill become filters, largest first and Other last', () => {
  const bySection = { 1: ['Other'], 2: ['Tax', 'Energy'], 3: ['Energy'] };
  const index = buildIssueIndex(bySection, tagSections, { 2: 40 });
  assert.deepStrictEqual(index.map((i) => i.name), ['Energy', 'Tax', 'Other']);
  assert.deepStrictEqual(index[1].sections, [{ section_id: '2', header: 'Two', page: 40 }]);
  assert.strictEqual(index[2].sections[0].page, null);
});

test('a finding takes on the issues of its section', () => {
  const [tagged, untagged] = withIssues([{ section_id: '2' }, { section_id: '3' }], { 2: ['Tax'] });
  assert.deepStrictEqual(tagged.issues, ['Tax']);
  assert.deepStrictEqual(untagged.issues, []);
});

test('batches keep every section, whole and in order, within the limits', () => {
  const sections = [{ text: 'a'.repeat(60) }, { text: 'b'.repeat(50) }, { text: 'c'.repeat(500) }, { text: 'd' }, { text: 'e' }];
  const batches = tagBatches(sections, 2, 100);
  assert.deepStrictEqual(batches.map((b) => b.sections.length), [1, 1, 1, 2]);
  assert.deepStrictEqual(batches.flatMap((b) => b.sections), sections);
  assert.strictEqual(batches[2].sections[0].text.length, 500);
});

test('a pledge made about H.R. 1 can be direct on H.R. 1 but only possible on another bill', () => {
  const inputs = { items: [{ section_id: '70120' }], promises: [{ id: 'hr1-pledge', strength: 'Explicit vote pledge', about_bill: 'hr1' }] };
  assert.strictEqual(verifyAlerts([verdict('hr1-pledge')], { ...inputs, billId: 'hr1' }).alerts[0].severity, 'direct');
  assert.strictEqual(verifyAlerts([verdict('hr1-pledge')], { ...inputs, billId: 'u0123456789ab' }).alerts[0].severity, 'possible');
});

test('a summary bullet from a Word upload keeps its source even with no page number', () => {
  const overview = { what_it_does: [{ text: 'x', section_ids: ['70120'] }] };
  const result = verifyOverview(overview, { items: [{ section_id: '70120' }], pages: {} });
  assert.deepStrictEqual(result.what_it_does[0].sources, [{ section_id: '70120', page: null }]);
});

const { estimateCost } = require('../app/analyze.js');
const fakeSections = (n, chars) => Array.from({ length: n }, (_, i) => ({ id: String(i), header: 'h', part: '', text: 'x'.repeat(chars) }));

test('the cost estimate grows with the bill, and its cap stays within $0.25 to $3', () => {
  const small = estimateCost({ sections: fakeSections(1, 3000), promiseCount: 8, contextChars: 5000, needsIssues: true });
  const large = estimateCost({ sections: fakeSections(300, 3000), promiseCount: 8, contextChars: 5000, needsIssues: true });
  assert.ok(small.estimate < large.estimate);
  assert.strictEqual(small.cap, 0.25);
  assert.ok(large.cap > large.estimate && large.cap <= 3);
  const huge = estimateCost({ sections: fakeSections(2000, 20000), promiseCount: 8, contextChars: 5000, needsIssues: true });
  assert.strictEqual(huge.cap, 3);
});

test('a section number echoed as 1 or "Section 1" still matches its section', () => {
  const sections = [{ id: '1', header: 'One' }, { id: '2', header: 'Two' }, { id: '3', header: 'Three' }];
  const tags = [{ id: 1, issues: ['Tax'] }, { id: 'Section 2', issues: ['Tax'] }, { id: 'Sec. 3', issues: ['Tax'] }];
  const { bySection, untagged } = verifyIssueTags(tags, sections);
  assert.deepStrictEqual(Object.keys(bySection), ['1', '2', '3']);
  assert.deepStrictEqual(untagged, []);
});

// --- Bill-wide outline and honest failures (2026-11-24) ---
const { fatalModelError, FatalModelError, mapLimit, noImpactLine } = require('../app/analyze.js');

test('a summary bullet may cite a section screening read, even with no district finding', () => {
  const overview = { what_it_does: [{ text: 'Funds chip factories', section_ids: ['102', '99999'] }] };
  const result = verifyOverview(overview, { items: [], pages: { 102: 4 }, summarized: ['102', '103'] });
  assert.strictEqual(result.what_it_does.length, 1);
  assert.deepStrictEqual(result.what_it_does[0].sources, [{ section_id: '102', page: 4 }]);
});

test('the key\'s spending limit, no credits or a bad key stop the run; other errors are retried', () => {
  const limit = '{"error":{"message":"Key limit exceeded (monthly limit). Manage it using ..."}}';
  assert.ok(fatalModelError(403, limit) instanceof FatalModelError);
  assert.match(fatalModelError(403, limit).message, /spending limit/);
  assert.ok(fatalModelError(402, 'Insufficient credits') instanceof FatalModelError);
  assert.ok(fatalModelError(401, 'No auth') instanceof FatalModelError);
  assert.strictEqual(fatalModelError(429, 'Rate limited'), null);
  assert.strictEqual(fatalModelError(500, 'Server error'), null);
});

test('a refused key stops all remaining work at once instead of failing every section', async () => {
  let calls = 0;
  const items = Array.from({ length: 266 }, (_, i) => ({ id: String(i) }));
  await assert.rejects(
    mapLimit(items, async () => { calls++; throw new FatalModelError('limit'); }),
    FatalModelError
  );
  assert.ok(calls <= 10, `${calls} calls were made after the key was refused`);
});

test('"no effect" only claims what was actually read', () => {
  assert.strictEqual(noImpactLine({ id: 'NJ-5' }, 266, 266), 'None of this bill\'s 266 sections was found to materially affect NJ-5.');
  const partial = noImpactLine({ id: 'NJ-5' }, 266, 200);
  assert.match(partial, /200 were read/);
  assert.match(partial, /other 66 could not be read/);
});
