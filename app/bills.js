// The bills the app knows about: H.R. 1 (built in) and bills a user uploads.
// Uploads live in data/uploads/<id>/, which Git ignores so draft bills never reach GitHub.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BillText = require('./public/bill-text.js');

const DATA = path.join(__dirname, '..', 'data');
const UPLOADS = path.join(DATA, 'uploads');
const UPLOAD_ID = /^u[0-9a-f]{12}$/;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const TYPES = {
  pdf: { magic: '%PDF-', label: 'PDF' },
  docx: { magic: 'PK\u0003\u0004', label: 'Word document' },
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const HR1 = {
  id: 'hr1',
  title: 'H.R. 1: One Big Beautiful Bill Act',
  kind: 'official',
  status: 'Enacted July 4, 2025',
  file_type: 'pdf',
  verified_bill: true, // the official enrolled text, built in
};

function hr1() {
  const pageMap = readJson(path.join(DATA, 'hr1-pages.json'));
  return {
    ...HR1,
    pdf_url: pageMap.pdf_url,
    loadSections: () => readJson(path.join(DATA, 'hr1-sections.json')),
    pages: pageMap.pages,
    issuesFile: path.join(DATA, 'hr1-issues.json'),
    briefFile: (memberId) => path.join(DATA, 'briefs', `hr1-${memberId}.json`),
  };
}

function upload(id) {
  if (!UPLOAD_ID.test(id || '')) return null;
  const dir = path.join(UPLOADS, id);
  if (!fs.existsSync(path.join(dir, 'bill.json'))) return null;
  const meta = readJson(path.join(dir, 'bill.json'));
  const sections = () => readJson(path.join(dir, 'sections.json'));
  return {
    ...meta,
    kind: 'upload',
    // Uploads saved since the bill check record the markers found. Earlier uploads were split on real
    // "SEC." headings, which only bill text has in that form here, so they count as bills too.
    verified_bill: Array.isArray(meta.bill_markers) || meta.split_method === 'headings',
    pdf_url: meta.file_type === 'pdf' ? `/api/bills/${id}/file` : null,
    loadSections: sections,
    get pages() {
      return Object.fromEntries(sections().filter((s) => s.page).map((s) => [s.id, s.page]));
    },
    filePath: path.join(dir, `original.${meta.file_type}`),
    issuesFile: path.join(dir, 'issues.json'),
    briefFile: (memberId) => path.join(dir, 'briefs', `${memberId}.json`),
    // Whose bill list this upload belongs to: the member it was uploaded for. Uploads saved before
    // uploads were tied to a member don't record one, so they belong to the members who already have
    // an analysis of them (their files are left as they are).
    owners: meta.member ? [meta.member]
      : fs.existsSync(path.join(dir, 'briefs')) ? fs.readdirSync(path.join(dir, 'briefs')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)) : [],
  };
}

// H.R. 1 is shown to every member; an upload only to its owners.
function visibleTo(bill, memberId) {
  return bill.kind !== 'upload' || bill.owners.includes(memberId);
}

// Ids come from the browser, so they only ever select a bill that exists.
function getBill(id) {
  if (!id || id === 'hr1') return hr1();
  return upload(id);
}

// The bills one member sees: H.R. 1, then that member's own uploads, newest first.
function listBills(memberId) {
  const uploads = fs.existsSync(UPLOADS)
    ? fs.readdirSync(UPLOADS).map(upload).filter((b) => b && visibleTo(b, memberId)).sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];
  return [hr1(), ...uploads];
}

// Checks an upload and saves it. The browser extracted the text (the server has no PDF or
// Word reader); the server re-splits that text itself and keeps the original file.
// `member` is the member the bill is uploaded for (the server checks it is a real member id); only
// that member's bill list shows it.
function saveUpload({ title, file_type, file_name, file_base64, pages, member }) {
  if (!/^[a-z0-9-]{1,60}$/.test(String(member || ''))) throw new Error('Choose the member this bill is for, then upload it again.');
  const name = String(title || '').replace(/[\u0000-\u001f]/g, '').trim();
  if (!name) throw new Error('Give the bill a name.');
  if (name.length > 120) throw new Error('Keep the name under 120 characters.');
  const type = TYPES[file_type];
  if (!type) throw new Error('Only PDF and Word (.docx) files are supported.');
  const bytes = Buffer.from(String(file_base64 || ''), 'base64');
  if (!bytes.length) throw new Error('The file is empty.');
  if (bytes.length > MAX_FILE_BYTES) throw new Error('The file is larger than 15 MB.');
  if (bytes.subarray(0, type.magic.length).toString('latin1') !== type.magic) {
    throw new Error(`This file is not a valid ${type.label}.`);
  }
  if (!Array.isArray(pages) || !pages.every((p) => Array.isArray(p) && p.every((l) => typeof l === 'string'))) {
    throw new Error('The extracted text was not in the expected format.');
  }

  const result = BillText.fromPages(pages); // throws, with the reason, for anything that is not a bill
  // A Word file has no fixed pages, so its sections have none.
  const sections = result.sections.map((s) => ({ ...s, page: file_type === 'pdf' ? s.page : null }));

  const id = `u${crypto.randomBytes(6).toString('hex')}`;
  const dir = path.join(UPLOADS, id);
  fs.mkdirSync(path.join(dir, 'briefs'), { recursive: true });
  fs.writeFileSync(path.join(dir, `original.${file_type}`), bytes);
  fs.writeFileSync(path.join(dir, 'sections.json'), JSON.stringify(sections, null, 1));
  const meta = {
    id,
    title: name,
    member, // whose bill list it appears in
    status: 'Uploaded; not yet voted on',
    file_type,
    file_name: path.basename(String(file_name || `bill.${file_type}`)).slice(0, 200),
    created_at: new Date().toISOString(),
    section_count: sections.length,
    split_method: result.method,
    bill_markers: result.markers, // which standard bill wording was found, e.g. ["clause", "number"]
    skipped_chars: result.skipped_chars,
    chars: result.chars,
  };
  fs.writeFileSync(path.join(dir, 'bill.json'), JSON.stringify(meta, null, 2));
  return meta;
}

// Removes one member's brief on one bill from the app. Nothing is erased: the file moves to the
// Git-ignored data/deleted/ folder (named by time, bill and member), so a brief deleted by mistake
// can be copied back by hand instead of paying for a new run. Returns where it went, or null.
function deleteBrief(bill, memberId, deletedDir = path.join(DATA, 'deleted')) {
  const file = bill.briefFile(memberId);
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(deletedDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(deletedDir, `${stamp}-${bill.id}-${memberId}.json`);
  fs.renameSync(file, target);
  return target;
}

module.exports = { getBill, listBills, visibleTo, saveUpload, deleteBrief, UPLOADS, MAX_FILE_BYTES };
