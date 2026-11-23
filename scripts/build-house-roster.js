// Builds data/house-119.json: every current member of the U.S. House (119th Congress) with their
// state, district, party and Bioguide ID, for the setup page's member boxes.
//
// Source: the public-domain congress-legislators project (unitedstates/congress-legislators),
// read in memory; only the House fields we show are saved. Free, no key needed.
//   node scripts/build-house-roster.js
// Portraits for these members live in app/public/photos/<bioguide_id>.jpg (see AGENTS.md).
const fs = require('fs');
const path = require('path');

const SOURCE = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const OUT = path.join(__dirname, '..', 'data', 'house-119.json');
const PARTY = { Democrat: 'D', Republican: 'R', Independent: 'I' };
const DELEGATE_TITLE = { PR: 'Res. Comm.' }; // Puerto Rico's member is a Resident Commissioner

// "NJ-5"; a state with one seat is "AK-AL" (at large); a non-voting delegate is "DC-Del".
function districtLabel(term, delegates) {
  if (delegates.has(term.state)) return `${term.state}-Del`;
  return term.district === 0 ? `${term.state}-AL` : `${term.state}-${term.district}`;
}

async function main() {
  const res = await fetch(SOURCE, { headers: { 'User-Agent': 'BillReader-class-project/1.0' } });
  if (!res.ok) throw new Error(`Could not download the roster (${res.status})`);
  const people = await res.json();
  const house = people.map((p) => ({ p, term: p.terms[p.terms.length - 1] })).filter(({ term }) => term.type === 'rep');
  const delegates = new Set(['DC', 'PR', 'GU', 'VI', 'AS', 'MP']);
  const members = house.map(({ p, term }) => {
    const n = p.name;
    // A few first names carry the nickname in parentheses, e.g. "Nicole (Nikki)": use the nickname.
    const first = (n.first.match(/\(([^)]+)\)/) || [])[1] || n.first;
    return {
      bioguide_id: p.id.bioguide,
      name: `${n.nickname || first} ${n.last}${n.suffix ? ` ${n.suffix}` : ''}`,
      title: delegates.has(term.state) ? DELEGATE_TITLE[term.state] || 'Del.' : 'Rep.',
      party: PARTY[term.party] || term.party,
      state: term.state,
      district: districtLabel(term, delegates),
      seat: term.district, // for sorting: 0 = at large or delegate
    };
  }).sort((a, b) => a.state.localeCompare(b.state) || a.seat - b.seat);
  for (const m of members) {
    if (!/^[A-Z]\d{6}$/.test(m.bioguide_id)) throw new Error(`Unexpected Bioguide ID for ${m.name}`);
  }
  const out = {
    congress: 119,
    source: 'unitedstates/congress-legislators (public domain)',
    source_url: SOURCE,
    built: new Date().toISOString().slice(0, 10),
    note: 'Current House members only; a vacant seat has no entry. Portraits: app/public/photos/<bioguide_id>.jpg.',
    members,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  const parties = members.reduce((t, m) => ({ ...t, [m.party]: (t[m.party] || 0) + 1 }), {});
  console.log(`Wrote ${members.length} House members to ${path.relative(process.cwd(), OUT)}:`, parties);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
