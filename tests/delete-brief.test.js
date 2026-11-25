// Run with: node --test
// Deleting an analysis moves the brief to a recovery folder instead of erasing it. Uses a
// temporary folder, never the real data/ files.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { deleteBrief, getBill } = require('../app/bills.js');

function fakeBill(dir) {
  return { id: 'u0123456789ab', briefFile: (memberId) => path.join(dir, 'briefs', `${memberId}.json`) };
}

test('moves the brief to the deleted folder, contents unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-reader-'));
  const bill = fakeBill(dir);
  fs.mkdirSync(path.join(dir, 'briefs'));
  fs.writeFileSync(bill.briefFile('gottheimer'), '{"cost_usd":0.33}');
  const deletedDir = path.join(dir, 'deleted');

  const moved = deleteBrief(bill, 'gottheimer', deletedDir);
  assert.ok(moved.startsWith(deletedDir));
  assert.match(path.basename(moved), /-u0123456789ab-gottheimer\.json$/);
  assert.strictEqual(fs.readFileSync(moved, 'utf8'), '{"cost_usd":0.33}');
  assert.strictEqual(fs.existsSync(bill.briefFile('gottheimer')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('does nothing when there is no brief, and leaves other members alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-reader-'));
  const bill = fakeBill(dir);
  fs.mkdirSync(path.join(dir, 'briefs'));
  fs.writeFileSync(bill.briefFile('kean'), '{}');
  assert.strictEqual(deleteBrief(bill, 'gottheimer', path.join(dir, 'deleted')), null);
  assert.strictEqual(fs.existsSync(bill.briefFile('kean')), true);
  assert.strictEqual(fs.existsSync(path.join(dir, 'deleted')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bill ids from the browser cannot point outside the bill folders', () => {
  assert.strictEqual(getBill('../briefs'), null);
  assert.strictEqual(getBill('u../../x'), null);
});
