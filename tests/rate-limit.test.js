// Run with: node --test
// These check the per-visitor rate limits, using a fake clock so no test has to wait.
const test = require('node:test');
const assert = require('node:assert');
const { createLimiter, bucketsFor, visitorOf, LIMITS } = require('../app/rate-limit.js');

test('allows up to the limit, then refuses with a wait time', () => {
  let t = 0;
  const limiter = createLimiter({ ai: { max: 3, windowMs: 10000 } }, () => t);
  assert.deepStrictEqual([1, 2, 3].map(() => limiter.check('ai', 'a').allowed), [true, true, true]);
  t = 4000;
  const refused = limiter.check('ai', 'a');
  assert.strictEqual(refused.allowed, false);
  assert.strictEqual(refused.retryAfter, 6);
});

test('a new window starts after the old one ends', () => {
  let t = 0;
  const limiter = createLimiter({ ai: { max: 1, windowMs: 1000 } }, () => t);
  limiter.check('ai', 'a');
  assert.strictEqual(limiter.check('ai', 'a').allowed, false);
  t = 1000;
  assert.strictEqual(limiter.check('ai', 'a').allowed, true);
});

test('each visitor and each bucket is counted separately', () => {
  const limiter = createLimiter({ ai: { max: 1, windowMs: 1000 }, write: { max: 1, windowMs: 1000 } }, () => 0);
  limiter.check('ai', 'a');
  assert.strictEqual(limiter.check('ai', 'b').allowed, true);
  assert.strictEqual(limiter.check('write', 'a').allowed, true);
  assert.strictEqual(limiter.check('ai', 'a').allowed, false);
});

test('30 calls in a row to the AI route: the first 10 pass, the other 20 are refused', () => {
  const limiter = createLimiter(LIMITS, () => 0);
  const results = Array.from({ length: 30 }, () => limiter.check('ai', 'visitor').allowed);
  assert.strictEqual(results.filter(Boolean).length, 10);
  assert.strictEqual(results.slice(10).every((ok) => !ok), true);
});

test('prune forgets windows that have ended', () => {
  let t = 0;
  const limiter = createLimiter({ ai: { max: 5, windowMs: 1000 } }, () => t);
  limiter.check('ai', 'a');
  limiter.check('ai', 'b');
  t = 1000;
  limiter.prune();
  assert.strictEqual(limiter.size(), 0);
});

test('paid and write routes get their own limits on top of the overall one', () => {
  assert.deepStrictEqual(bucketsFor('POST', '/api/analyze'), ['all', 'ai']);
  assert.deepStrictEqual(bucketsFor('GET', '/api/estimate'), ['all', 'ai']);
  assert.deepStrictEqual(bucketsFor('POST', '/api/bills'), ['all', 'write']);
  assert.deepStrictEqual(bucketsFor('POST', '/api/candidates/review'), ['all', 'write']);
  assert.deepStrictEqual(bucketsFor('GET', '/api/members'), ['all']);
});

test('memory is capped: once full, new visitors are refused instead of remembered', () => {
  const limiter = createLimiter({ all: { max: 5, windowMs: 1000 } }, () => 0, 3);
  ['a', 'b', 'c'].forEach((v) => limiter.check('all', v));
  assert.strictEqual(limiter.check('all', 'forged-1').allowed, false);
  assert.strictEqual(limiter.size(), 3);
  assert.strictEqual(limiter.check('all', 'a').allowed, true); // known visitors still work
});

test('behind a proxy, a forged first X-Forwarded-For entry is ignored; the proxy-added last one counts', () => {
  const forged = { headers: { 'x-forwarded-for': '198.51.100.7, 203.0.113.5' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.strictEqual(visitorOf(forged, true), '203.0.113.5');
});

test('True-Client-IP (set by the host) wins over X-Forwarded-For', () => {
  const req = { headers: { 'true-client-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.7, 10.0.0.2' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.strictEqual(visitorOf(req, true), '203.0.113.9');
});

test('CF-Connecting-IP is not trusted (Render passes a forged one through)', () => {
  const req = { headers: { 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '203.0.113.5' }, socket: { remoteAddress: '10.0.0.1' } };
  assert.strictEqual(visitorOf(req, true), '203.0.113.5');
});

test('locally, forwarding headers are ignored entirely', () => {
  const req = { headers: { 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': '198.51.100.8' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.strictEqual(visitorOf(req, false), '127.0.0.1');
});
