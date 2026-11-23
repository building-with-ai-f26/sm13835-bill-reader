// Builds data/us-map.json: every state (plus D.C.) and the congressional districts of the states
// listed in DISTRICT_STATES, drawn in the standard U.S. map projection with Alaska and Hawaii
// moved into the lower-left corner. Source: U.S. Census Bureau cartographic boundary files.
//
// Run: node scripts/build-us-map.js
// The Census zip files are read in memory only; nothing but data/us-map.json is written.
// To add districts for more states, add their two-letter codes to DISTRICT_STATES and re-run.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DISTRICT_STATES = ['NJ'];
const BASE = 'https://www2.census.gov/geo/tiger/GENZ2024/shp/';
const STATES_ZIP = 'cb_2024_us_state_5m.zip'; // 1:5,000,000: enough detail to zoom to one state
const DISTRICTS_ZIP = 'cb_2024_us_cd119_500k.zip'; // 1:500,000, the same detail as the NJ map
const OUT = path.join(__dirname, '..', 'data', 'us-map.json');

// ---- Reading a zip file (stored or deflated entries) with Node's built-in zlib.
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a zip file');
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0, n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

// ---- Shapefile attributes (.dbf): one object per record.
function readDbf(buf) {
  const count = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const fields = [];
  for (let p = 32; buf[p] !== 0x0d; p += 32) {
    fields.push({ name: buf.toString('latin1', p, p + 11).replace(/\0.*$/, ''), len: buf[p + 16] });
  }
  const rows = [];
  for (let i = 0; i < count; i++) {
    let p = headerLen + i * recordLen + 1; // first byte is the deleted flag
    const row = {};
    for (const f of fields) { row[f.name] = buf.toString('latin1', p, p + f.len).trim(); p += f.len; }
    rows.push(row);
  }
  return rows;
}

// ---- Shapefile geometry (.shp): polygons as lists of rings of [lon, lat].
function readShp(buf) {
  const shapes = [];
  let p = 100;
  while (p < buf.length) {
    const words = buf.readInt32BE(p + 4);
    const type = buf.readInt32LE(p + 8);
    const rings = [];
    if (type === 5) {
      const numParts = buf.readInt32LE(p + 44);
      const numPoints = buf.readInt32LE(p + 48);
      const parts = [];
      for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(p + 52 + i * 4));
      const pts = p + 52 + numParts * 4;
      for (let i = 0; i < numParts; i++) {
        const ring = [];
        for (let j = parts[i]; j < (i + 1 < numParts ? parts[i + 1] : numPoints); j++) {
          ring.push([buf.readDoubleLE(pts + j * 16), buf.readDoubleLE(pts + j * 16 + 8)]);
        }
        rings.push(ring);
      }
    }
    shapes.push(rings);
    p += 8 + words * 2;
  }
  return shapes;
}

// ---- Projection: Albers equal-area conic, combined the same way as the standard "Albers USA"
// map (the constants match d3.geoAlbersUsa), so the lower 48, Alaska and Hawaii fit one frame.
const rad = Math.PI / 180;
function conicEqualArea({ parallels: [p0, p1], rotate, center, scale, translate }) {
  const sy0 = Math.sin(p0 * rad);
  const n = (sy0 + Math.sin(p1 * rad)) / 2;
  const c = 1 + sy0 * (2 * n - sy0);
  const r0 = Math.sqrt(c) / n;
  const raw = (lambda, phi) => {
    const r = Math.sqrt(c - 2 * n * Math.sin(phi)) / n;
    return [r * Math.sin(lambda * n), r0 - r * Math.cos(lambda * n)];
  };
  const [cx, cy] = raw(center[0] * rad, center[1] * rad);
  return ([lon, lat]) => {
    let l = lon + rotate;
    l = ((((l + 180) % 360) + 360) % 360) - 180; // keeps Alaska's Aleutian Islands together
    const [x, y] = raw(l * rad, lat * rad);
    return [translate[0] + scale * (x - cx), translate[1] - scale * (y - cy)];
  };
}
const K = 1070;
const [TX, TY] = [480, 250];
const lower48 = conicEqualArea({ parallels: [29.5, 45.5], rotate: 96, center: [-0.6, 38.7], scale: K, translate: [TX, TY] });
const alaska = conicEqualArea({ parallels: [55, 65], rotate: 154, center: [-2, 58.5], scale: K * 0.35, translate: [TX - 0.307 * K, TY + 0.201 * K] });
const hawaii = conicEqualArea({ parallels: [8, 18], rotate: 157, center: [-3, 19.9], scale: K, translate: [TX - 0.205 * K, TY + 0.212 * K] });
const projectionFor = (fips) => (fips === '02' ? alaska : fips === '15' ? hawaii : lower48);

// ---- Rings to an SVG path, dropping points closer than `tolerance` pixels to the last kept one.
function toPath(rings, project, tolerance, digits) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const parts = [];
  for (const ring of rings) {
    const kept = [];
    for (const point of ring) {
      const [x, y] = project(point);
      const last = kept[kept.length - 1];
      if (!last || Math.hypot(x - last[0], y - last[1]) >= tolerance) kept.push([x, y]);
    }
    if (kept.length < 3) continue;
    // Skip islands too small to see even when zoomed to this shape (Alaska has thousands).
    const xs = kept.map((k) => k[0]); const ys = kept.map((k) => k[1]);
    if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < tolerance * 4) continue;
    for (const [x, y] of kept) {
      bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y);
      bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y);
    }
    // Relative steps ("l dx dy") are much shorter than absolute positions. Each step is taken
    // between rounded points, so rounding never accumulates along the outline.
    const f = 10 ** digits;
    const r = kept.map(([x, y]) => [Math.round(x * f), Math.round(y * f)]);
    const num = (v) => String(v / f).replace(/^(-?)0\./, '$1.');
    let d = `M${num(r[0][0])} ${num(r[0][1])}l`;
    for (let i = 1; i < r.length; i++) {
      const dx = r[i][0] - r[i - 1][0], dy = r[i][1] - r[i - 1][1];
      if (dx || dy) d += `${i > 1 ? ' ' : ''}${num(dx)} ${num(dy)}`;
    }
    parts.push(d + 'z');
  }
  return { path: parts.join(''), bbox: bbox.map((v) => Number(v.toFixed(2))) };
}

// Point spacing scaled to each shape's size: about 400 steps across its longest side, so a small
// state like New Jersey keeps fine detail when the map zooms to it, and large states stay light.
function detailFor(rings, project) {
  const pts = rings.flat().map(project);
  const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  const h = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
  return Math.max(w, h) / 400;
}

async function load(name) {
  process.stdout.write(`Fetching ${name}… `);
  const response = await fetch(BASE + name);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const files = unzip(Buffer.from(await response.arrayBuffer()));
  const base = name.replace(/\.zip$/, '');
  console.log('read');
  return { rows: readDbf(files[`${base}.dbf`]), shapes: readShp(files[`${base}.shp`]) };
}

async function main() {
  const st = await load(STATES_ZIP);
  const states = st.rows
    .map((row, i) => ({ row, rings: st.shapes[i] }))
    .filter(({ row }) => Number(row.STATEFP) <= 56) // 50 states and D.C.; territories are left out
    .map(({ row, rings }) => ({ fips: row.STATEFP, abbr: row.STUSPS, name: row.NAME, ...(() => { const tol = detailFor(rings, projectionFor(row.STATEFP)); return toPath(rings, projectionFor(row.STATEFP), tol, tol >= 0.3 ? 1 : 2); })() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const abbrByFips = Object.fromEntries(states.map((s) => [s.fips, s.abbr]));

  const cd = await load(DISTRICTS_ZIP);
  const districts = cd.rows
    .map((row, i) => ({ row, rings: cd.shapes[i] }))
    .filter(({ row }) => DISTRICT_STATES.includes(abbrByFips[row.STATEFP]) && /^\d+$/.test(row.CD119FP) && row.CD119FP !== 'ZZ')
    .map(({ row, rings }) => {
      const num = Number(row.CD119FP);
      return { id: `${abbrByFips[row.STATEFP]}-${num === 0 ? 'AL' : num}`, state: abbrByFips[row.STATEFP], ...toPath(rings, projectionFor(row.STATEFP), 0.008, 2) }; // fine: districts are only shown zoomed in
    })
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

  const all = [...states, ...districts].map((s) => s.bbox);
  const pad = 10;
  const box = [Math.min(...all.map((b) => b[0])) - pad, Math.min(...all.map((b) => b[1])) - pad, Math.max(...all.map((b) => b[2])) + pad, Math.max(...all.map((b) => b[3])) + pad];
  const map = {
    viewBox: [box[0], box[1], box[2] - box[0], box[3] - box[1]].map((v) => Number(v.toFixed(1))).join(' '),
    projection: 'Albers equal-area (Albers USA layout: Alaska and Hawaii inset)',
    source: 'U.S. Census Bureau cartographic boundary files, 2024: states 1:5,000,000; 119th Congress districts 1:500,000',
    source_url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html',
    district_states: DISTRICT_STATES,
    states,
    districts,
  };
  fs.writeFileSync(OUT, JSON.stringify(map));
  console.log(`Wrote ${path.relative(process.cwd(), OUT)}: ${states.length} states, ${districts.length} districts, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}

main().catch((error) => { console.error(error.message); process.exit(1); });
