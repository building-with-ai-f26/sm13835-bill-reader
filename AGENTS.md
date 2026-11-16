# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Bill Reader turns a long House bill into a plain-English brief personalized to one member's district and public commitments, with alerts when a yes vote would conflict with a commitment.
- **Primary user & core workflow:** Members of Congress and their legislative staff. See the living PRD in `docs/index.html`.
- **Tech stack:** Node 24 (built-in modules only) / plain HTML / JSON files in `data/` / OpenRouter API (Claude Haiku and Sonnet) / PostHog analytics

## 2. Project Structure
```
app/
  server.js          Local web server: serves the page, the JSON API, uploads and paid runs (localhost only)
  analyze.js         The AI pipeline: estimate, screen (Haiku), analyze (Sonnet), check commitments, verify, save
  bills.js           Finds H.R. 1 and uploaded bills; validates and saves uploads
  public/
    index.html       The whole app UI (sign-in, setup, bill list, upload, brief, Analyze panel) and PostHog
    bill-text.js     Splits PDF/Word text into bill sections; shared by the browser and the tests
data/
  members/<id>.json      One file per NJ member: party, district, H.R. 1 votes, cited commitments
  districts/nj-NN.json   Census facts and 2006-2024 House results for each district
  briefs/hr1-<id>.json   Generated H.R. 1 briefs (committed)
  hr1-issues.json        Issue tags for H.R. 1 sections, shared by every member's brief
  uploads/               Uploaded bills and their briefs. Git-ignored: drafts never leave this computer
docs/
  index.html         Public Product Page (GitHub Pages): demo, living PRD, build log
  build2/            Demo screenshots used on the Product Page
tests/               Deterministic tests: citation checks, alert rules, data files, bill splitting
journal/             Optional weekly working notes
.env.example         Names of the settings .env needs (never real values)
```

## 3. Setup & Run
1. Install Node 24 (`node --version` should print v24). There are no packages to install.
2. Copy the settings file: `cp .env.example .env`, then put your OpenRouter key after `OPENROUTER_API_KEY=`. `.env` is Git-ignored; never paste the key in chat or code. Without a key the app still shows saved briefs, but Analyze is disabled.
3. Keep OpenRouter's Auto Top-Up off, so spending can never exceed the credits already bought.
4. Start the server: `node app/server.js`, then open http://localhost:3000. Sign in with anything, choose a member, then a bill.
5. Run the tests: `node --test` (no network, no cost).
6. PostHog analytics: the snippet is in `app/public/index.html` and `docs/index.html`. Its `phc_` project key is public by design. Session replay is on, but anything marked `ph-no-capture` (uploaded bill text, upload previews and upload briefs) is hidden, and typed text is masked. Keep that class on any new element that shows uploaded content.

## 4. Commands
- **Install dependencies:** None. Requires Node 24. For model runs: `cp .env.example .env`, then add your key.
- **Generate a brief (paid model calls):** use the Analyze button on a bill's page, or `node app/analyze.js --member <id> [--bill <bill id>]`, where `<id>` is a file name in `data/members` (e.g. `kean`) and the bill defaults to H.R. 1. Each run shows an estimate and stops at its own cap (never above $3). Member data (votes, commitments) is in `data/members/`, district data (Census, elections) in `data/districts/`, H.R. 1 briefs in `data/briefs/`.
- **Uploaded bills:** saved in `data/uploads/<id>/` (original file, sections, briefs). Git ignores this folder because uploads may be unreleased drafts. The page reads PDF and Word files in the browser with pdf.js 3.11.174 and mammoth 1.8.0, loaded from public CDNs with integrity hashes.
- **Run locally:** `node app/server.js`, then open http://localhost:3000 (prototype sign-in accepts anything)
- **Run deterministic tests:** `node --test`
- **Run model evals:** Not built yet (planned for Build 4, Track A).

## 5. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
