// Adds party registration facts to each NJ district file (data/districts/nj-NN.json): registered voters,
// and the share and count registered with each party (or with none).
//   node scripts/add-party-registration.js
// Source: NJ Division of Elections, Statewide Voter Registration Summary by congressional district (monthly PDF).
// Node has no built-in PDF reader, so the report's table is copied below exactly as printed. To update it,
// open the newest report from https://nj.gov/state/elections/election-information-svrs.shtml, replace
// REPORT (date, URL and rows) and re-run. The script refuses rows whose parties don't add up to the total.
// Safe to re-run: facts with the same key are replaced. Back up data/districts/ first (AGENTS.md rule 7).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'districts');
const REPORT = {
  date: 'Nov. 1, 2026',
  url: 'https://www.nj.gov/state/elections/assets/pdf/svrs-reports/2026/2026-11-voter-registration-by-congressional-district.pdf',
  columns: ['UNA', 'DEM', 'REP', 'CNV', 'CON', 'GRE', 'LIB', 'NAT', 'RFP', 'SSP', 'total'],
  rows: {
    1: [196732, 257893, 122024, 1223, 1083, 1088, 2514, 591, 128, 813, 584089],
    2: [208827, 178340, 201777, 1406, 1243, 1002, 2642, 556, 130, 797, 596720],
    3: [224343, 224992, 170509, 1161, 896, 999, 2351, 436, 95, 689, 626471],
    4: [213501, 135701, 237533, 1170, 879, 844, 2181, 350, 96, 507, 592762],
    5: [215859, 208801, 161860, 993, 667, 877, 2073, 297, 77, 506, 592010],
    6: [202317, 209199, 106613, 1110, 1069, 995, 1849, 463, 110, 721, 524446],
    7: [213795, 202524, 218231, 1058, 749, 947, 2725, 338, 94, 588, 641049],
    8: [152426, 220720, 54908, 863, 877, 777, 1553, 390, 123, 632, 433269],
    9: [183110, 195141, 101895, 1249, 1084, 991, 1595, 494, 131, 683, 486373],
    10: [181674, 275536, 48040, 1047, 1147, 846, 1317, 577, 173, 766, 511123],
    11: [207152, 232699, 165349, 806, 629, 880, 1813, 308, 69, 494, 610199],
    12: [207105, 237132, 98055, 1087, 964, 1057, 1662, 444, 105, 677, 548288],
  },
};
// The report's party codes, in the order shown on the page (largest groups first).
const PARTIES = [
  ['DEM', 'reg_dem', 'Democratic'],
  ['REP', 'reg_rep', 'Republican'],
  ['UNA', 'reg_una', 'Unaffiliated (no party)'],
  ['LIB', 'reg_lib', 'Libertarian'],
  ['CNV', 'reg_cnv', 'Conservative Party'],
  ['GRE', 'reg_gre', 'Green Party'],
  ['CON', 'reg_con', 'Constitution Party'],
  ['SSP', 'reg_ssp', 'Socialist Party'],
  ['NAT', 'reg_nat', 'Natural Law Party'],
  ['RFP', 'reg_rfp', 'Reform Party'],
];
const SOURCE = `NJ Division of Elections voter registration, ${REPORT.date}`;

const num = (n) => n.toLocaleString('en-US');
const pct = (part, whole) => Math.round((part / whole) * 1000) / 10;

function factsFor(row) {
  const at = (code) => row[REPORT.columns.indexOf(code)];
  const total = at('total');
  const sum = REPORT.columns.filter((c) => c !== 'total').reduce((t, c) => t + at(c), 0);
  if (sum !== total) throw new Error(`Parties add up to ${sum}, but the total is ${total}`);
  return [
    { key: 'reg_total', label: 'Registered voters', value: total, display: num(total), source: SOURCE },
    ...PARTIES.map(([code, key, label]) => ({
      key: `${key}_pct`, label, value: pct(at(code), total), display: `${pct(at(code), total).toFixed(1)}% (${num(at(code))} voters)`, source: SOURCE,
    })),
  ];
}

const files = fs.readdirSync(DIR).filter((f) => /^nj-\d\d\.json$/.test(f)).sort();
for (const file of files) {
  const row = REPORT.rows[Number(file.slice(3, 5))];
  if (!row) throw new Error(`No registration row for ${file}`);
  const added = factsFor(row);
  const full = path.join(DIR, file);
  const district = JSON.parse(fs.readFileSync(full, 'utf8'));
  const keys = new Set(added.map((f) => f.key));
  const kept = district.facts.filter((f) => !keys.has(f.key));
  const firstElection = kept.findIndex((f) => /_20\d\d$/.test(f.key)); // margin_2024, turnout_2024 stay last
  const where = firstElection < 0 ? kept.length : firstElection;
  district.facts = [...kept.slice(0, where), ...added, ...kept.slice(where)];
  const name = `NJ Division of Elections, Statewide Voter Registration Summary by congressional district (${REPORT.date})`;
  district.sources = [...district.sources.filter((s) => !/NJ Division of Elections/.test(s.name)), { name, url: REPORT.url }];
  fs.writeFileSync(full, JSON.stringify(district, null, 2) + '\n');
  console.log(`${district.id}: ${added.slice(0, 4).map((f) => `${f.label.split(' ')[0]} ${f.display.split(' (')[0]}`).join(' · ')}`);
}
