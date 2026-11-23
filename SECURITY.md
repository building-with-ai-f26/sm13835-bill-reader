# SECURITY.md — Bill Reader

Security review for Assignment 3 (beginner lane), done 2026-11-22 with my coding agent (Claude Code).
Live app: https://sm13835-bill-reader.onrender.com · Repo: https://github.com/sm13835/sm13835-bill-reader

## 1. What kind of app this is

**AI app, no database.** Bill Reader calls paid AI models (Claude through OpenRouter) to write briefs,
but it has no database: data lives in JSON files in the repo.

There are two ways it runs:

| | Local app (my laptop) | Public demo (Render) |
|---|---|---|
| AI calls (Analyze, TV statement extraction) | Yes, with my OpenRouter key in a Git-ignored `.env` | **No.** No key on Render; the server refuses paid runs even if a key were added |
| Saves data (uploads, review approvals) | Yes, to local files | **No.** Every write (`POST`) is refused |
| Who can reach it | Only this computer (bound to 127.0.0.1, host and origin checks) | Anyone with the link |
| Sign-in | Prototype screen; accepts anything, saves nothing | Same, clearly labeled |

The public demo turns read-only automatically when it detects Render (the `RENDER` variable) or
`READ_ONLY=1`, so a deploy can't accidentally spend money or store anything.

## 2. What I checked, what I found, what I fixed

| Check | How | Result |
|---|---|---|
| **Access-control test (AI app, no DB): key not exposed** | Downloaded everything the live site serves (the page, its script, all 9 API responses) and tried to fetch private files directly (`/.env`, `/.env.example`, `/app/server.js`, `/package.json`, a data file) | **Pass.** No secret patterns or key fragments in anything served; every private file returned 404. The analyze estimate reports `has_key: false` on Render. |
| **Access-control test: 30 calls to the AI route** | `POST /api/analyze` 30 times in a row on the live site | **Pass.** Calls 1–10 returned 403 (read-only refusal); calls 11–30 returned **429 Too Many Requests** with `Retry-After: ~600`. The other AI route (`/api/estimate`) was also limited; normal pages still returned 200. |
| **Secret search: repo** | `git grep` for `sb_secret_`, `service_role`, `sk-or-`, `sk-ant-`, `sk-proj-`, `sk_live_` in all tracked files | **Pass.** Only the placeholder in `.env.example` (`sk-or-v1-replace-with-your-key`). |
| **Secret search: full Git history** | Same patterns across every commit (`git log -p --all`), plus a fragment of my real OpenRouter key (key itself never printed) | **Pass.** `.env` has never been committed; my key appears in no file and no commit. No rotation needed. |
| **Secret search: live site** | Same patterns plus my key fragment in everything the live site serves | **Pass.** Only PostHog's `phc_` project key, which is public by design. |
| **File storage** | Reviewed where files are written | **Not applicable.** No storage buckets. Uploads are saved only on my laptop (`data/uploads/`, Git-ignored) and are refused on the public demo. TV transcripts (network content) stay in Git-ignored `data/media/transcripts/`. |
| **Protect production from the agent** | Added an **"Ask me first" list** to `AGENTS.md` (rule 7) | **Done.** Force-pushes and history rewrites, deleting data, touching `.env`, changing the Render service or its variables, paid runs, raising caps, and dependency changes all need my explicit yes. No database, so no database backup is needed; the repo is on GitHub. |
| **Spending cap** | OpenRouter settings | **Done.** Prepaid credits with **Auto Top-Up off** (the balance is the absolute ceiling), plus a **$5 monthly credit limit** on the API key. Every paid run also shows an estimate and has its own hard cap (H.R. 1 brief ≤ $3; TV extraction ≤ $1) and a $1 balance floor. |
| **Rate limits** | Added `app/rate-limit.js` | **Fixed.** Per-visitor limits on every request: AI routes 10 per 10 minutes, write routes 60 a minute, everything 300 a minute; over the limit returns 429. Member portraits (`/photos/<Bioguide ID>.jpg`, small static files) have their own 1,200-a-minute allowance (added 2026-11-23), because one large state shows dozens at once; the photo route only serves files named like a Bioguide ID. Memory is capped so a flood of fake visitors can't grow it. One forged-header bypass remains on Render (finding 6 and section 3). |
| **Dependency audit: server** | `npm audit` | **Pass.** 0 vulnerabilities (the server has no npm dependencies; `package-lock.json` added so the audit can run). |
| **Dependency audit: browser libraries** | `npm audit` on the two libraries the page loads from CDNs | **Found and fixed.** **pdf.js 3.11.174 — high:** a malicious PDF could run JavaScript ([GHSA-wgrm-67xf-hhpq](https://github.com/advisories/GHSA-wgrm-67xf-hhpq)); fixed with `isEvalSupported: false`, the advisory's documented fix. **mammoth 1.8.0 — moderate:** directory traversal ([GHSA-rmjr-87wv-gf87](https://github.com/advisories/GHSA-rmjr-87wv-gf87)); upgraded to 1.13.0 with a new integrity hash. (The audit also listed `tar`, which only comes with pdf.js's Node add-on that the browser never loads.) Re-tested: PDF and Word uploads still preview correctly. |
| **Agent security review** | Claude read the server and page code looking for holes, then attacked the live site | See below. |

### Agent security review: findings

1. **Path traversal (e.g. `../../.env`): not vulnerable.** Ids from the browser are only matched against
   files that exist, never used to build a path; upload ids must match `u` + 12 hex characters.
2. **Cross-site attacks on the local app: not vulnerable.** Writes must be JSON, from the app's own origin,
   to a `localhost` host name (blocks other websites and DNS rebinding).
3. **Injected HTML/script (XSS): not vulnerable.** Every value from uploads, AI output and transcripts
   goes through `esc()` or `textContent` before reaching the page.
4. **Error leaks: none.** Unexpected errors return a generic "Server error".
5. **Missing browser security headers → fixed.** Every response now sends `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY` (no embedding in other sites) and `Referrer-Policy: strict-origin-when-cross-origin`.
6. **Rate limit could be bypassed with forged address headers → mostly fixed; one gap remains.** On
   Render, a visitor can send their own address headers. First live test: five made-up
   `X-Forwarded-For` addresses each got a fresh allowance. Fix 1 used the proxy-added (last)
   `X-Forwarded-For` entry and the edge-network headers; a second live test showed a forged
   `CF-Connecting-IP` still got through, so fix 2 stopped reading that header and trusts only
   `True-Client-IP` or the last `X-Forwarded-For` entry. **Final live test (after fix 2):** forged
   `X-Forwarded-For` (three variants), `True-Client-IP` and `X-Real-IP` were all limited (429), but a
   forged `CF-Connecting-IP` still received a fresh allowance, even though the app no longer reads it,
   so Render's edge appears to copy it into the headers it sets. Following the project rule to stop
   after repeated failed fixes, I recorded this as a remaining issue instead of guessing a third
   approach (see below).

## 3. Remaining issues and limits

- **The per-visitor rate limit can still be dodged on Render with a forged `CF-Connecting-IP` header.**
  Impact is low: every public route is free and read-only, and the AI routes are refused outright (403),
  so this cannot spend money or change data; it only lets a scripted client get around the flood limit
  (300 requests a minute). Proper fix: confirm with Render which client-address header its edge sets
  and visitors cannot override, or put the app behind a proxy I control, then re-run the forged-header test.

- **No real sign-in.** The sign-in screen is a labeled prototype. That is acceptable because the public demo
  holds only public information (bills, Census data, public votes and statements) and saves nothing; real
  accounts would be needed before letting offices store drafts online.
- **No Content-Security-Policy yet.** The page uses inline scripts and loads PostHog and two CDN libraries
  (both pinned with integrity hashes). A strict CSP would need the scripts moved into files.
- **pdf.js is still on 3.x.** The high-severity issue is closed by the documented setting, but moving to
  pdf.js 4.2.67+ would remove it at the source.
- **Rate limits live in memory.** A restart clears them, and they are per server instance. Fine for one
  free instance; a shared store would be needed if the app ever ran on several.
- **Free hosting sleeps.** Render's free plan sleeps after about 15 minutes idle; the first visit then takes
  up to a minute. Not a security issue, but it affects availability.
- **The local app trusts whoever uses this laptop.** It has no login; it is protected by only listening on
  this computer.
