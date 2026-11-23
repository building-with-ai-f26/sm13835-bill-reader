// Adds immigration, entitlement, health, education, jobs and housing facts to each NJ district file
// (data/districts/nj-NN.json), from the same source as the existing facts: the Census Bureau's
// American Community Survey 2024 1-year estimates, read through Census Reporter's free API (no key).
//   node scripts/add-district-facts.js
// Safe to re-run: a fact with the same key is replaced, never duplicated. Election facts stay last.
// Back up data/districts/ first (AGENTS.md rule 7).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'districts');
const API = 'https://api.censusreporter.org/1.0/data/show/acs2024_1yr';
const TABLES = ['B05002', 'C16001', 'B19055', 'C27006', 'B27010', 'B15003', 'B23025', 'B25077', 'B25064'];
const SOURCE = 'ACS 2024 1-year estimates';

const num = (n) => Math.round(n).toLocaleString('en-US');
const pct = (part, whole) => Math.round((part / whole) * 1000) / 10;

// Every column in a table whose name matches, added up (e.g. "No health insurance coverage" appears once per age group).
function sumWhere(response, geo, table, pattern) {
  const { columns } = response.tables[table];
  const estimate = response.data[geo][table].estimate;
  return Object.entries(columns).filter(([, c]) => pattern.test(c.name)).reduce((total, [id]) => total + estimate[id], 0);
}

function factsFor(r, geo) {
  const e = (table, column) => r.data[geo][table].estimate[column];
  const people = e('B05002', 'B05002001');
  const foreignBorn = e('B05002', 'B05002013');
  const nonCitizen = e('B05002', 'B05002021');
  const age5 = e('C16001', 'C16001001');
  const otherLanguage = age5 - e('C16001', 'C16001002');
  const limitedEnglish = sumWhere(r, geo, 'C16001', /less than "very well"/);
  const households = e('B19055', 'B19055001');
  const socialSecurity = e('B19055', 'B19055002');
  const covered = e('C27006', 'C27006001');
  const medicare = sumWhere(r, geo, 'C27006', /^With Medicare coverage$/);
  const insuredBase = e('B27010', 'B27010001');
  const uninsured = sumWhere(r, geo, 'B27010', /^No health insurance coverage$/);
  const adults25 = e('B15003', 'B15003001');
  const degree = ['B15003022', 'B15003023', 'B15003024', 'B15003025'].reduce((t, c) => t + e('B15003', c), 0);
  const laborForce = e('B23025', 'B23025003');
  const unemployed = e('B23025', 'B23025005');
  const homeValue = e('B25077', 'B25077001');
  const rent = e('B25064', 'B25064001');
  const share = (key, label, part, whole, unit) => ({ key, label, value: pct(part, whole), display: `${pct(part, whole).toFixed(1)}% (${num(part)} ${unit})`, source: SOURCE });
  return [
    share('foreign_born_pct', 'Residents born outside the U.S.', foreignBorn, people, 'people'),
    share('noncitizen_pct', 'Residents who are not U.S. citizens', nonCitizen, people, 'people'),
    share('other_language_pct', 'Residents 5 and older who speak a language other than English at home', otherLanguage, age5, 'people'),
    share('limited_english_pct', 'Residents 5 and older who speak English less than "very well"', limitedEnglish, age5, 'people'),
    share('social_security_households_pct', 'Households receiving Social Security', socialSecurity, households, 'households'),
    share('medicare_coverage_pct', 'Residents with Medicare coverage', medicare, covered, 'people'),
    share('uninsured_pct', 'Residents without health insurance', uninsured, insuredBase, 'people'),
    share('bachelors_pct', 'Adults 25 and older with a bachelor\'s degree or higher', degree, adults25, 'adults'),
    { key: 'unemployment_pct', label: 'Unemployment rate (civilian labor force)', value: pct(unemployed, laborForce), display: `${pct(unemployed, laborForce).toFixed(1)}%`, source: SOURCE },
    { key: 'median_home_value', label: 'Median home value (owner-occupied)', value: homeValue, display: `$${num(homeValue)}`, source: SOURCE },
    { key: 'median_gross_rent', label: 'Median gross rent', value: rent, display: `$${num(rent)} a month`, source: SOURCE },
  ];
}

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /^nj-\d\d\.json$/.test(f)).sort();
  const geos = files.map((f) => `50000US34${f.slice(3, 5)}`);
  const res = await fetch(`${API}?table_ids=${TABLES.join(',')}&geo_ids=${geos.join(',')}`, { headers: { 'User-Agent': 'BillReader-class-project/1.0' } });
  if (!res.ok) throw new Error(`Census Reporter answered ${res.status}`);
  const r = await res.json();
  if (r.error) throw new Error(r.error);
  files.forEach((file, i) => {
    const full = path.join(DIR, file);
    const district = JSON.parse(fs.readFileSync(full, 'utf8'));
    const added = factsFor(r, geos[i]);
    const keys = new Set(added.map((f) => f.key));
    const kept = district.facts.filter((f) => !keys.has(f.key));
    const firstElection = kept.findIndex((f) => /_20\d\d$/.test(f.key)); // margin_2024, turnout_2024 stay last
    const at = firstElection < 0 ? kept.length : firstElection;
    district.facts = [...kept.slice(0, at), ...added, ...kept.slice(at)];
    fs.writeFileSync(full, JSON.stringify(district, null, 2) + '\n');
    console.log(`${district.id}: ${district.facts.length} facts (foreign-born ${added[0].display}; uninsured ${added[6].display})`);
  });
}

main().catch((error) => { console.error(error.message); process.exit(1); });
