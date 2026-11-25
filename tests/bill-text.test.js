// Run with: node --test
// These check how an uploaded bill's text is cleaned and split into sections.
const test = require('node:test');
const assert = require('node:assert');
const BillText = require('../app/public/bill-text.js');
const { saveUpload } = require('../app/bills.js');
const { normalize } = require('../app/analyze.js');

// Text pieces pdf.js read from the real H.R. 9626 PDF (GovInfo, introduced version).
const hr9626 = require('./fixtures/hr9626-pdf-items.json');

test('a real GovInfo PDF loses its line numbers, page marks and footers', () => {
  const result = BillText.fromPages(hr9626.map(BillText.pageLines));
  assert.strictEqual(result.method, 'headings');
  assert.strictEqual(result.sections.length, 1);
  const [section] = result.sections;
  assert.strictEqual(section.id, '1');
  assert.strictEqual(section.header, 'ELIMINATION OF STATE AND LOCAL TAX DEDUCTION MARRIAGE PENALTY');
  assert.strictEqual(section.page, 1);
  assert.match(section.text, /Internal Revenue Code of 1986/); // "In-" + "ternal" rejoined
  assert.doesNotMatch(section.text, /VerDate|•HR|^\d+ /m);
});

const page = (...lines) => lines;
// The wording every bill opens with; made-up test bills need it to pass the bill check.
const ENACT = 'Be it enacted by the Senate and House of Representatives of the United States of America in Congress assembled,';

test('quoted amendment text and the table of contents do not start new sections', () => {
  const text = BillText.fromPages([
    page('A BILL', ENACT, 'SECTION 1. TABLE OF CONTENTS.', 'Sec. 2. Tips.', 'Sec. 3. Overtime.'),
    page('SEC. 2. TIPS.', '(a) Part VII is amended by inserting:', '‘‘SEC. 224. QUALIFIED TIPS.', '‘‘(a) There shall be allowed a deduction.’’.'),
    page('TITLE II—LABOR', 'SEC. 3. OVERTIME.', 'Overtime pay is deductible.'),
  ]);
  assert.deepStrictEqual(text.sections.map((s) => s.id), ['1', '2', '3']);
  assert.match(text.sections[1].text, /SEC\. 224/);
  assert.strictEqual(text.sections[2].part, 'TITLE II—LABOR');
  assert.strictEqual(text.sections[2].page, 3);
});

test('a heading that wraps onto the next line is kept whole', () => {
  const { sections } = BillText.fromPages([page('AN ACT', ENACT, 'SEC. 70120. LIMITATION ON INDIVIDUAL DEDUCTIONS FOR CERTAIN', 'STATE AND LOCAL TAXES, ETC.', '(a) In general.')]);
  assert.strictEqual(sections[0].header, 'LIMITATION ON INDIVIDUAL DEDUCTIONS FOR CERTAIN STATE AND LOCAL TAXES, ETC');
});

test('a Word-style bill with mixed-case headings still splits', () => {
  const { sections, method } = BillText.fromPages([page('A BILL', ENACT, 'Sec. 1. Short title.', 'This Act may be cited as the Test Act.', 'Sec. 2. Findings.', 'Congress finds.')]);
  assert.strictEqual(method, 'headings');
  assert.deepStrictEqual(sections.map((s) => [s.id, s.header]), [['1', 'Short title'], ['2', 'Findings']]);
});

test('a short bill with no section headings is cut into numbered parts, not dropped', () => {
  const { sections, method } = BillText.fromPages([page('H. R. 1234', 'A BILL', ENACT + ' That section 164(b)(6) of the Internal Revenue Code is amended.')]);
  assert.strictEqual(method, 'chunks');
  assert.strictEqual(sections[0].id, 'part-1');
});

test('an empty or image-only PDF is refused with a clear reason', () => {
  assert.throws(() => BillText.fromPages([[], []]), /scanned PDF/);
});

const pdfBase64 = Buffer.from('%PDF-1.4 test').toString('base64');
const goodUpload = { title: 'Test bill', file_type: 'pdf', file_name: 'a.pdf', file_base64: pdfBase64, pages: [['A BILL', ENACT, 'SEC. 1. TEST.', 'Text.']] };

test('uploads are refused before anything is saved when they fail a check', () => {
  assert.throws(() => saveUpload({ ...goodUpload, title: '  ' }), /name/);
  assert.throws(() => saveUpload({ ...goodUpload, file_type: 'exe' }), /Only PDF and Word/);
  assert.throws(() => saveUpload({ ...goodUpload, file_base64: Buffer.from('not a pdf').toString('base64') }), /not a valid PDF/);
  assert.throws(() => saveUpload({ ...goodUpload, file_type: 'docx' }), /not a valid Word/);
  assert.throws(() => saveUpload({ ...goodUpload, pages: 'SEC. 1.' }), /expected format/);
  assert.throws(() => saveUpload({ ...goodUpload, pages: [['MEMORANDUM', 'Talking points.']] }), /doesn't look like a bill/);
});

test('quote checks ignore nested quote marks and line-break hyphens', () => {
  // After pages are joined, "re-" + "evaluation" at a line break reads "reevaluation";
  // a model quoting it may restore the hyphen, as below.
  const billText = 'by striking ‘‘2026, $40,400,’’\nand the re-evaluation';
  assert.ok(normalize(billText).includes(normalize('by striking 2026, $40,400, and the reevaluation')));
  assert.ok(!normalize(billText).includes(normalize('by striking 2027')));
});

test('real bill text passes the bill check and records what was found', () => {
  const result = BillText.fromPages(hr9626.map(BillText.pageLines));
  assert.deepStrictEqual(result.markers, ['clause', 'number', 'congress', 'title', 'sections']);
  // A discussion draft (no number yet) and a simple resolution pass too.
  assert.ok(BillText.fromPages([page('[DISCUSSION DRAFT]', 'A BILL', 'To do things.', ENACT, 'SECTION 1. SHORT TITLE.', 'This Act may be cited as the Test Act.')]));
  assert.ok(BillText.fromPages([page('H. RES. 12', 'IN THE HOUSE OF REPRESENTATIVES', 'RESOLUTION', 'Resolved, That the House honors the Test team.')]));
});

test('documents that are not bills are refused, even when they talk about bills', () => {
  const refused = (lines) => assert.throws(() => BillText.fromPages([lines]), /doesn't look like a bill.*congress\.gov/s);
  refused(['MEMORANDUM', 'To: Staff', 'Re: H.R. 1 talking points for the 119th Congress', 'The bill passed the House.']); // number + Congress, no clause
  refused(['Senate passes S. 1260', 'WASHINGTON — The Senate voted 68-32 in the 117th Congress on the bill.']); // a news story
  refused(['MEMORANDUM', 'Re: H.R. 1 talking points for the 119th Congress', 'Section 1. Background.', 'The bill passed.', 'Section 2. Next steps.', 'Prepare remarks.']); // + numbered sections
  refused(['SERVICES AGREEMENT', 'Section 1. Definitions.', 'In this agreement...', 'Section 2. Term.', 'One year.']); // numbered sections only
  refused(['Jane Doe', 'Résumé', 'Experience: Legislative aide.']);
});

test('the bill check says exactly what is missing', () => {
  const { ok, found, message } = BillText.billCheck('Section 1. Definitions.', true);
  assert.strictEqual(ok, false);
  assert.deepStrictEqual(found, ['sections']);
  assert.match(message, /enacting clause/);
  assert.match(message, /bill number/);
});
