# AGENTS.md — Coding Agent Operating Manual

> Give this file to your coding agent and check that it is using these instructions. Keep the stack, commands, and ground rules current.

## 1. Project Overview
- **What this repo builds:** Bill Reader turns a long House bill into a plain-English brief personalized to one member's district and public commitments, with alerts when a yes vote would conflict with a commitment.
- **Primary user & core workflow:** Members of Congress and their legislative staff. See the living PRD in `docs/index.html`.
- **Tech stack:** Node 24 (built-in modules only) / plain HTML / JSON files in `data/` / OpenRouter API (Claude Haiku and Sonnet; Gemini for TV transcripts) / PostHog analytics

## 2. Project Structure
```
app/
  server.js          Local web server: serves the page, the JSON API, uploads and paid runs (localhost only)
  analyze.js         The AI pipeline: estimate, screen (Haiku), analyze (Sonnet), check commitments, verify, save
  media.js           TV transcripts → candidate promises and record claims (Sonnet), each quote checked word for word
  bills.js           Finds H.R. 1 and uploaded bills; validates and saves uploads
  public/
    index.html       The whole app UI (landing page, prototype sign-up that saves nothing (its form is switched off for demos with SIGNUP_FORM = false, so
                     choosing Member of Congress or Congressional Staff opens setup directly), sign-in, setup with state picker, member boxes and U.S. map, member home, bill list, upload, brief,
                     Analyze panel, Media Panel page: the member's public commitments, TV appearances and the TV review list) and PostHog
    logos/           TV network logos for the Media Panel's network boxes (public-domain text logos from Wikimedia
                     Commons; the two CBS logos are cropped to the eye), served at /logos/<name>.svg; a new
                     network needs a file here and an entry in NETWORK_LOGOS in index.html
    bill-text.js     Splits PDF/Word text into bill sections; shared by the browser and the tests
    photos/          Official House portraits (public domain) for every current House member, named by Bioguide ID
                     (e.g. G000583.jpg), 160px squares served at /photos/<id>.jpg for the setup page's member boxes
scripts/
  add-district-facts.js  Adds immigration, entitlement, health, education, jobs and housing facts to
                     data/districts/ from Census Reporter (ACS 2024 1-year); re-runnable
  add-student-debt.js    Adds student loan estimates to data/districts/ (Urban Institute county data weighted
                     to each district with Census tract populations); re-runnable
  add-party-registration.js  Adds NJ party registration by district to data/districts/ (official monthly report)
  build-house-roster.js  Builds data/house-119.json (every current House member) from the public-domain
                     congress-legislators project
  build-us-map.js    Builds data/us-map.json from Census boundary files (read in memory; nothing else saved)
  summarize-transcripts.js  Writes data/media/<id>-transcripts.json (counts only, no text) for the public demo
package.json         Tells hosts to use Node 24 and how to start (npm start); no dependencies
data/
  members/<id>.json      One file per NJ member: party, honorific, district, H.R. 1 votes, cited commitments
                         (promises), and approved TV record claims
  districts/nj-NN.json   Census facts and 2006-2024 House results for each district
  briefs/hr1-<id>.json   Generated H.R. 1 briefs (committed)
  hr1-issues.json        Issue tags for H.R. 1 sections, shared by every member's brief
  house-119.json         Every current House member: name, party, state, district, Bioguide ID (setup page boxes;
                         only states with files in members/ open briefs)
  nj-map.json            New Jersey district map used on briefs and the member home page
  us-map.json            U.S. states (Alaska and Hawaii inset) and district lines for DISTRICT_STATES (NJ)
  media/<id>.json        A member's TV appearances: date, network, show, YouTube link, notes
  media/<id>-candidates.json  Statements pulled from those appearances, each pending/approved/rejected
  media/transcripts/     Full TV transcripts (network content). Git-ignored: stays on this computer
  uploads/               Uploaded bills and their briefs. Git-ignored: drafts never leave this computer
  deleted/               Briefs removed with the bill menu's Delete, named <time>-<bill>-<member>.json. Git-ignored;
                         copy one back to its briefs folder to restore it
docs/
  index.html         Public Product Page (GitHub Pages): demo, living PRD, build log
  build2/            Demo screenshots used on the Product Page
tests/               Deterministic tests: citation checks, alert rules, data files, bill splitting, TV quote checks
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
7. TV appearances (optional, paid): transcripts are made by Gemini watching each appearance's YouTube link through OpenRouter, so no video or audio is ever downloaded. Only the member's own quoted words and links are committed; full transcripts stay in the Git-ignored `data/media/transcripts/`.

## 4. Deploy (public read-only demo on Render)
**Live:** https://sm13835-bill-reader.onrender.com (Render web service `sm13835-bill-reader`, free plan, deployed 2026-11-22).

The public app is a **read-only demo**: visitors sign in with anything, choose New Jersey, a member and their district, and read that member's saved H.R. 1 brief, district info and promises. It never spends money and never saves anything:
- **No OpenRouter key on Render, ever.** The server also refuses paid runs, uploads and approvals whenever it detects Render (`RENDER` is set automatically) or `READ_ONLY=1`, and it ignores any key it finds there.
- **No database is needed:** the demo stores nothing. Uploads and approvals stay in the local app, because Render wipes saved files on every restart and uploads may be unreleased drafts.
- **Full TV transcripts are not deployed** (Git-ignored); the Media Panel page uses the committed counts in `data/media/<id>-transcripts.json`.

Steps (first time):
1. Push the latest code to GitHub (`main`). Run `node --test` first; all tests must pass.
2. Sign in at https://render.com (free account, no card needed for the free plan).
3. **New → Web Services.** Under the source options, choose **Public Git Repository** and paste `https://github.com/building-with-ai-f26/sm13835-bill-reader` (the repo is public), then **Connect**. This is how the live demo was deployed.
   - Optional upgrade: if Render shows a GitHub list with this repo (after granting Render access to it on GitHub), pick it there instead; then every push to `main` redeploys automatically.
4. Fill in:
   - **Name:** `sm13835-bill-reader` (this becomes the address `https://<name>.onrender.com`)
   - **Branch:** `main` · **Runtime/Language:** Node · **Region:** any US region
   - **Build command:** `npm install` (installs nothing; there are no dependencies)
   - **Start command:** `npm start` (runs `node app/server.js`)
   - **Instance type:** Free
   - **Environment variables:** add `READ_ONLY` = `1`. **Do not add `OPENROUTER_API_KEY`.**
   - **Health check path** (under Advanced, if shown): `/api/config`
5. **Create Web Service.** Wait for the log to say `Bill Reader public demo (read-only) on port …`, then open the URL Render shows.
6. Check it on a phone: landing page → Sign in → New Jersey → a member → their district → Continue → Review Uploaded Bills → H.R. 1 → each tab. The Analyze panel and Upload page should say the demo is read-only.

**Updating the live demo:** a service created from a public repository link does **not** redeploy on its own. After pushing app changes to `main`, open the service in Render and click **Manual Deploy → Deploy latest commit**, then repeat the phone check in step 6. (Changes to `docs/` or `AGENTS.md` alone don't need a redeploy.)

Free instances sleep after about 15 minutes without visitors, so the first visit after a break takes up to a minute to load. Open the link shortly before sharing or presenting it.

To check the read-only mode locally before deploying: `READ_ONLY=1 PORT=3100 node app/server.js`, then open http://localhost:3100.

## 5. Commands
- **Install dependencies:** None. Requires Node 24. For model runs: `cp .env.example .env`, then add your key.
- **Generate a brief (paid model calls):** use the Analyze button on a bill's page, or `node app/analyze.js --member <id> [--bill <bill id>]`, where `<id>` is a file name in `data/members` (e.g. `kean`) and the bill defaults to H.R. 1. Each run shows an estimate and stops at its own cap (never above $3). Member data (votes, commitments) is in `data/members/`, district data (Census, elections) in `data/districts/`, H.R. 1 briefs in `data/briefs/`.
- **Bill check (uploads):** only bill text can be uploaded and analyzed. `billCheck` in `app/public/bill-text.js` looks for standard bill wording: the enacting clause ("Be it enacted by the Senate and House of Representatives…", or a resolving clause), a bill number, a Congress/chamber line, a title line ("A BILL", "AN ACT"), a public law header and numbered sections. It passes with the clause plus one more marker, or without the clause only with bill number + Congress line + numbered sections + title line or public law header. It runs in the browser preview and again on the server when saving; the markers found are stored in the upload's `bill.json` (`bill_markers`), and Analyze refuses any upload without them (uploads saved before the check count if they were split on "SEC." headings). It is a format check, not proof; the cost cap still limits any run.
- **Uploaded bills:** saved in `data/uploads/<id>/` (original file, sections, briefs). Git ignores this folder because uploads may be unreleased drafts. The page reads PDF and Word files in the browser with pdf.js 3.11.174 and mammoth 1.13.0, loaded from public CDNs with integrity hashes.
- **Bill menu (⋮):** on "Review Uploaded Bills", each bill with a finished analysis for the member has a ⋮ menu: **Download** opens a print-ready copy of the whole analysis in the browser's print window (choose "Save as PDF"; no PDF library), **Share** shows the planned Email / Text message / Post on X options (preview only, not connected yet), and **Delete** (hidden on the read-only demo) removes the analysis.
- **Delete an analysis (local app only):** from the bill menu, after an "Are you sure?" pop-up, `POST /api/brief/delete` moves that member's brief to `data/deleted/` (never erased) and Analyze becomes available again. Refused on the read-only demo, from other sites, and while that brief is being analyzed. Deleting an H.R. 1 brief removes a committed file from `data/briefs/`: Git shows it as deleted, and the public demo keeps showing it unless that deletion is committed. Restore with `git checkout data/briefs/<file>` or by copying the file back from `data/deleted/`.
- **TV statements (paid, about $0.60 per member):** `node app/media.js --member <id>` reads that member's transcripts, keeps only statements quoted word for word from the member's own lines, checks official transcripts where they exist, and writes `data/media/<id>-candidates.json` as pending. Review them on the member's Media Panel page; only approved items join the member's file. A re-run refuses to overwrite reviewed items. Cap $1, balance floor $1.
- **District facts (free):** `node scripts/add-district-facts.js` adds or refreshes 11 Census facts per NJ district (foreign-born, non-citizens, other language at home, limited English, Social Security, Medicare, uninsured, bachelor's degree, unemployment, median home value, median rent) from Census Reporter (no key; the Census Bureau's own API now requires one). Back up `data/districts/` first. The District Info page groups every fact by topic (`FACT_GROUPS` in `index.html`); a new fact key appears under "Other" until it is added to a group. AI briefs see all district facts, so new facts reach the next paid run, not existing briefs.
- **Student loan facts (free, estimates):** `node scripts/add-student-debt.js` adds three facts per NJ district (share of residents with student loan debt, typical balance among borrowers, share of borrowers behind on payments), shown in the "Education" box under the bachelor's degree share. No agency publishes these by district, so the script weights the Urban Institute's Debt in America county figures (credit-bureau records, August 2026) by how many people each county contributes to the district (Census 2020 tract-to-district file for the 119th Congress, ACS 2024 5-year tract populations; split tracts divided by land area). Averaging county medians is an approximation, so every label says "(estimate)". Read in memory; back up `data/districts/` first. When Urban publishes a new update, change `URBAN_CSV` and the date in `SOURCE`.
- **Party registration (free, official):** `node scripts/add-party-registration.js` adds registered voters and the share and count for each party (Democratic, Republican, Unaffiliated, Libertarian, Conservative, Green, Constitution, Socialist, Natural Law, Reform) per NJ district, shown in the "Party Affiliation" box. Source: the NJ Division of Elections' monthly Statewide Voter Registration Summary by congressional district (PDF). Node can't read PDFs without a package, so the report's table is copied into the script's `REPORT`; to update, paste the newest month's rows, date and URL from https://nj.gov/state/elections/election-information-svrs.shtml and re-run (it refuses rows that don't add up). This is registration, not ideology: no source measures a left-right spectrum by district reliably (the CES survey has about 130 NJ respondents per district), so none is shown. Back up `data/districts/` first.
- **Refresh the House roster:** `node scripts/build-house-roster.js` (free). Members who are new since the last run need a portrait in `app/public/photos/<bioguide_id>.jpg`: the official photo from https://unitedstates.github.io/images/congress/450x550/<id>.jpg (or bioguide.congress.gov), cropped to a 160px head-and-shoulders square. `node --test` fails until every member has one.
- **Rebuild the U.S. map:** `node scripts/build-us-map.js` (free). Add state codes to `DISTRICT_STATES` to draw more states' districts.
- **Run locally:** `node app/server.js`, then open http://localhost:3000 (prototype sign-in accepts anything)
- **Run deterministic tests:** `node --test`
- **Run model evals:** Not built yet (planned for Build 4, Track A).

## 6. Non-Negotiable Engineering Rules
1. **Plan before coding:** Before touching multiple files, propose a brief plan and wait for approval.
2. **Small batches:** Make small, focused changes that can be reviewed and explained by a human in a single Pull Request.
3. **Explainability:** Avoid unnecessary abstractions or dependencies. Help the human builder understand the main components, what changed, why it matters, what could break, and how it was checked.
4. **Verify changes:** Run relevant checks. For a reproducible logic bug, use a failing test to demonstrate the fix when practical. Record manual checks and known limitations; follow the selected Build 4 evaluation track.
5. **Zero secrets in code:** Never hardcode API keys, tokens, or credentials. Always read from environment variables (`.env`) and update `.env.example` when new variables are needed.
6. **Stop when looping:** If a fix fails twice in a row, stop, summarize what failed, and ask the human before trying a third approach.
7. **Ask me first:** Never do any of the following without the human's explicit "yes" for that specific action, even if an earlier, similar action was approved:
   - **Git history:** `git push --force`, `git reset --hard`, rebasing or amending pushed commits, deleting branches, or any commit or push the human did not ask for.
   - **Deleting data:** `rm -rf`, or deleting or overwriting anything in `data/members/`, `data/districts/`, `data/briefs/`, `data/media/` (including transcripts and reviewed candidates) or `data/uploads/`. Back up a file before rewriting it.
   - **Secrets:** opening, printing, copying or editing `.env`, or putting any key in code, chat, logs or a host's settings. The OpenRouter key must never be added to Render.
   - **Production (Render):** deleting or changing the Render service, its environment variables (especially removing `READ_ONLY`), or turning off read-only mode.
   - **Spending:** any paid model run (`app/analyze.js`, `app/media.js`, transcription, the Analyze button) without showing the estimate and cap first; raising a cap; turning on OpenRouter Auto Top-Up.
   - **Dependencies:** adding a package, changing a CDN library or its integrity hash, or `npm audit fix --force`.
   There is no database, so there is nothing to back up beyond the Git repository (which GitHub keeps) and the Git-ignored local folders (`data/uploads/`, `data/media/transcripts/`), which should be copied before any risky change.
