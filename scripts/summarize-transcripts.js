// Writes data/media/<id>-transcripts.json: per-transcript counts (length, number of the member's
// words, cost) with no transcript text, so the public demo's Data Model page can show them.
// The full transcripts are network content and stay in the Git-ignored data/media/transcripts/.
// Run after transcribing: node scripts/summarize-transcripts.js <member id>
const fs = require('fs');
const path = require('path');

const memberId = process.argv[2];
if (!memberId || !/^[a-z-]+$/.test(memberId)) { console.error('Usage: node scripts/summarize-transcripts.js <member id>'); process.exit(1); }
const dir = path.join(__dirname, '..', 'data', 'media', 'transcripts', memberId);
const isMember = (turn) => turn.speaker !== 'HOST' && turn.speaker !== 'OTHER';

const transcripts = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const own = t.turns.filter(isMember);
  return {
    id: f.replace(/\.json$/, ''),
    duration: t.duration,
    turns: t.turns.length,
    member_turns: own.length,
    member_words: own.reduce((n, turn) => n + String(turn.text || '').split(/\s+/).filter(Boolean).length, 0),
    model: t.source?.model,
    cost_usd: t.source?.cost_usd,
  };
});
const out = path.join(__dirname, '..', 'data', 'media', `${memberId}-transcripts.json`);
fs.writeFileSync(out, JSON.stringify({ member: memberId, note: 'Counts only; transcript text is not included.', transcripts }, null, 2) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), out)}: ${transcripts.length} transcripts, ${transcripts.reduce((n, t) => n + t.member_words, 0)} member words`);
