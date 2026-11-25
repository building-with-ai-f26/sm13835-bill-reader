// Adds student loan facts to each NJ district file (data/districts/nj-NN.json): the share of residents
// with student loan debt, the median balance among them, and the share of borrowers behind on payments.
//   node scripts/add-student-debt.js
// No agency publishes these by congressional district, so they are ESTIMATES built from county figures:
//  1. Urban Institute, Debt in America (credit-bureau records, August 2026), one row per county.
//  2. Census 2020 tract-to-district relationship file (119th Congress): which tracts lie in which district;
//     a tract split between districts is divided by land area.
//  3. ACS 2024 5-year tract populations (via Census Reporter, no key): how many people each county
//     contributes to each district.
// A district's figure is the population-weighted average of its counties' figures (the median balance and
// the behind-on-payments share are weighted by the number of borrowers). Averaging county medians is an
// approximation, not a true district median. Everything is read in memory; nothing else is saved.
// Safe to re-run: facts with the same key are replaced. Back up data/districts/ first (AGENTS.md rule 7).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'districts');
const URBAN_CSV = 'https://raw.githubusercontent.com/UrbanInstitute/debt-interactive-map/master/data/20261022-update/county_student.csv';
const URBAN_PAGE = 'https://apps.urban.org/features/debt-interactive-map/';
const TRACTS_TO_CD = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_tract20_st34.txt';
const TRACT_POP = 'https://api.censusreporter.org/1.0/data/show/acs2024_5yr?table_ids=B01003&geo_ids=140|04000US34';
const SOURCE = 'Estimate: Urban Institute Debt in America (credit records, Aug. 2026), county figures weighted by population';
const HEADERS = { 'User-Agent': 'BillReader-class-project/1.0' };

async function get(url, as = 'text') {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return as === 'json' ? res.json() : res.text();
}

// Minimal CSV reader for Urban's file: every field is quoted, no commas inside fields.
function parseCsv(text) {
  const [head, ...rows] = text.trim().split('\n').map((line) => line.split(',').map((v) => v.replace(/^"|"$/g, '').trim()));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function main() {
  const [csv, rel, pop] = await Promise.all([get(URBAN_CSV), get(TRACTS_TO_CD), get(TRACT_POP, 'json')]);
  if (pop.error) throw new Error(pop.error);

  // County figures (New Jersey only).
  const counties = new Map();
  for (const row of parseCsv(csv).filter((r) => r.state_id === '34')) {
    const share = Number(row.stdtot), median = Number(row.stdtotpos_p50), behind = Number(row.stddelderogofstdtot);
    if ([share, median, behind].some((n) => !Number.isFinite(n))) throw new Error(`Missing figures for ${row.county}`);
    counties.set(row.id, { name: row.county, share, median, behind });
  }

  // People in each district, by county: tract population × the tract's land share in that district.
  const lines = rel.replace(/^﻿/, '').trim().split('\n');
  const col = Object.fromEntries(lines[0].split('|').map((h, i) => [h, i]));
  const pieces = {}; // district → county → people
  for (const line of lines.slice(1)) {
    const f = line.split('|');
    const cd = f[col.GEOID_CD119_20], tract = f[col.GEOID_TRACT_20];
    if (!/^34\d\d$/.test(cd) || cd.endsWith('ZZ')) continue;
    const people = pop.data[`14000US${tract}`]?.B01003.estimate.B01003001;
    if (people === undefined) continue; // water-only tracts have no population row
    const land = Number(f[col.AREALAND_TRACT_20]);
    const part = land > 0 ? Number(f[col.AREALAND_PART]) / land : 0;
    const county = tract.slice(0, 5);
    ((pieces[cd] ||= {})[county] ||= 0);
    pieces[cd][county] += people * part;
  }

  const files = fs.readdirSync(DIR).filter((f) => /^nj-\d\d\.json$/.test(f)).sort();
  for (const file of files) {
    const cd = `34${file.slice(3, 5)}`;
    const parts = Object.entries(pieces[cd] || {}).filter(([, n]) => n > 0);
    if (!parts.length) throw new Error(`No tracts found for district ${cd}`);
    let people = 0, borrowers = 0, balance = 0, behind = 0;
    for (const [id, n] of parts) {
      const c = counties.get(id);
      if (!c) throw new Error(`No Urban Institute row for county ${id}`);
      people += n;
      borrowers += n * c.share;
      balance += n * c.share * c.median;
      behind += n * c.share * c.behind;
    }
    const share = Math.round((borrowers / people) * 1000) / 10;
    const median = Math.round(balance / borrowers / 100) * 100;
    const late = Math.round((behind / borrowers) * 1000) / 10;
    const counted = parts.sort((a, b) => b[1] - a[1]).map(([id, n]) => `${counties.get(id).name} ${Math.round((n / people) * 100)}%`).join(', ');
    const added = [
      { key: 'student_debt_pct', label: 'Residents with student loan debt (estimate)', value: share, display: `${share.toFixed(1)}%`, source: SOURCE },
      { key: 'student_debt_median', label: 'Typical student loan balance, among borrowers (estimate)', value: median, display: `$${median.toLocaleString('en-US')}`, source: SOURCE },
      { key: 'student_debt_behind_pct', label: 'Student loan borrowers behind on payments (estimate)', value: late, display: `${late.toFixed(1)}%`, source: SOURCE },
    ];

    const full = path.join(DIR, file);
    const district = JSON.parse(fs.readFileSync(full, 'utf8'));
    const keys = new Set(added.map((f) => f.key));
    const kept = district.facts.filter((f) => !keys.has(f.key));
    const firstElection = kept.findIndex((f) => /_20\d\d$/.test(f.key)); // margin_2024, turnout_2024 stay last
    const at = firstElection < 0 ? kept.length : firstElection;
    district.facts = [...kept.slice(0, at), ...added, ...kept.slice(at)];
    const name = 'Urban Institute, Debt in America (student debt, credit data Aug. 2026), weighted to the district with Census tract populations';
    district.sources = [...district.sources.filter((s) => s.url !== URBAN_PAGE), { name, url: URBAN_PAGE }];
    fs.writeFileSync(full, JSON.stringify(district, null, 2) + '\n');
    console.log(`${district.id}: ${added.map((f) => f.display).join(' · ')} · population counted ${Math.round(people).toLocaleString('en-US')} · ${counted}`);
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
