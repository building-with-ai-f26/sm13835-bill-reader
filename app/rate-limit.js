// Per-visitor rate limits, kept in memory (a restart clears them, which is fine for this app).
// Each visitor (by IP address) gets a fixed number of requests per time window for each bucket;
// over the limit, the server answers 429 Too Many Requests with a Retry-After header.
const LIMITS = {
  ai: { max: 10, windowMs: 10 * 60 * 1000 }, // routes that call or prepare a paid AI run
  write: { max: 60, windowMs: 60 * 1000 }, // uploads and review decisions
  all: { max: 300, windowMs: 60 * 1000 }, // every request, so no one visitor can flood the server
  // Member portraits: small static files, and one big state shows dozens at once (California has 52),
  // so they get their own, larger allowance instead of using up the overall one.
  photos: { max: 1200, windowMs: 60 * 1000 },
};

// Most visitors the limiter remembers at once. A forged address header could otherwise make every
// request look like a new visitor and grow memory without end; when full, new visitors are refused.
const MAX_TRACKED = 20000;

function createLimiter(limits = LIMITS, now = () => Date.now(), maxTracked = MAX_TRACKED) {
  const hits = new Map(); // "bucket|visitor" → { count, resetAt }
  function check(bucket, visitor) {
    const { max, windowMs } = limits[bucket];
    const key = `${bucket}|${visitor}`;
    const t = now();
    let entry = hits.get(key);
    if (!entry && hits.size >= maxTracked) {
      prune();
      if (hits.size >= maxTracked) return { allowed: false, retryAfter: 60, remaining: 0 };
    }
    if (!entry || t >= entry.resetAt) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= max;
    return { allowed, retryAfter: allowed ? 0 : Math.ceil((entry.resetAt - t) / 1000), remaining: Math.max(0, max - entry.count) };
  }
  // Forget windows that have ended, so memory stays small.
  function prune() {
    const t = now();
    for (const [key, entry] of hits) if (t >= entry.resetAt) hits.delete(key);
  }
  return { check, prune, size: () => hits.size };
}

// Which buckets a request counts against. Every request counts against "all".
function bucketsFor(method, pathname) {
  if (method === 'GET' && pathname.startsWith('/photos/')) return ['photos'];
  const buckets = ['all'];
  if ((method === 'POST' && pathname === '/api/analyze') || (method === 'GET' && pathname === '/api/estimate')) buckets.push('ai');
  if (method === 'POST' && (pathname === '/api/bills' || pathname === '/api/candidates/review')) buckets.push('write');
  return buckets;
}

// The visitor's address. Locally, the connection's own address (forwarding headers are ignored,
// because any browser could fake them). Behind a host's proxy (Render), a visitor can send their
// own X-Forwarded-For, and the proxy adds the real address after it, so the FIRST entry can be
// forged (tested on the live site: it was). Use True-Client-IP when present, otherwise the LAST
// X-Forwarded-For entry. Live tests on Render (2026-11-22): forged first X-Forwarded-For entries
// and forged True-Client-IP headers were both overridden, but a forged CF-Connecting-IP was passed
// through untouched, so that header is deliberately not trusted.
function visitorOf(req, behindProxy) {
  if (behindProxy) {
    const edge = req.headers['true-client-ip'];
    if (edge) return String(edge).trim();
    const chain = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (chain.length) return chain[chain.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

module.exports = { LIMITS, createLimiter, bucketsFor, visitorOf };
