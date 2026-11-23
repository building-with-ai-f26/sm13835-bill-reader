---
name: bill-reader-ux
description: >-
  UX and visual rules for Bill Reader's app screens (sign-in, setup map, member home, bill list,
  upload, brief tabs, Media Panel page): plain copy, one consistent system, honest states, hover and
  press feedback, accessibility and phone layout, plus how to check a change before calling it done.
  Use whenever you design, restyle, add or review any screen or component in app/public/index.html,
  or when the user says something looks off, bland, cluttered or hard to use.
---

# Bill Reader UX

Bill Reader is a **working tool** for members of Congress and their legislative staff: they come to
decide how a bill affects their district and their public commitments, often between meetings and
often on a phone. The bar is a calm, trustworthy briefing tool, not a marketing site: every screen
should answer "what is this, what does it mean for my district, and what can I do next" fast.

These rules adapt the parts of taste-skill (Leonxlnx/taste-skill, MIT; see `LICENSE-taste-skill.txt`)
that fit an app, rewritten for this product. Its marketing-site rules (one section per screen, stock
photographs, shader effects, scroll moments) deliberately do **not** apply here.

## 1. Words

- **Headings name the thing:** "District impact", "Promise alerts", "Votes & bill text". A noun or a
  short plain claim, 1 to 6 words. Never a question, a pun, a command ("Get started") or a mood line.
- **Buttons are a verb plus what you get,** 1 to 5 words: "Continue to bills", "Analyze this bill",
  "Watch at 05:07". Never "Learn more", "Click here", "Submit", "Explore".
- **Numbers with units, uneven where real:** "26 hurt · 18 help · 15 mixed", "$1.28 estimated".
  Prefer the count to an adjective ("98 sections not analyzed", not "some sections").
- **Say what a state means and what to do:** an empty or blocked state names why and the next step
  ("Uploads are off in this public demo… To see a finished brief, open H.R. 1").
- **Errors name the field and the fix,** shown where the problem is, never a generic "Something went
  wrong". The server's error text is already written for people; show it (escaped).
- **Neutral, nonpartisan voice.** Describe what a bill does and what the evidence says; never tell a
  member how to vote. Party colours identify, they never judge.
- **Banned:** exclamation marks, all-caps labels written as caps (CSS `text-transform` on a name is
  fine), filler words (seamless, effortless, powerful, unlock, elevate, cutting-edge, robust),
  invented capitalised concepts, jokes in labels.

## 2. One system

Use what `app/public/index.html` already defines; extend it, never fork it.

- **Colour tokens on `:root`:** `--bg`, `--card`, `--text`, `--muted`, `--border`, `--accent`
  (navy `#1f3a5f`), `--accent-soft`, and the status trio `--bad/--bad-bg`, `--warn/--warn-bg`,
  `--good/--good-bg`. Status colours mean hurts / possible tension / helps, nothing else, and always
  come with a word or icon, never colour alone. Party colours (`.rep` deep red, `.dem` royal blue,
  `.ind` near-black) are for the member's name and district shading only.
- **Type:** Inter (400–800). The member welcome line is the one serif (Times New Roman italic).
- **Components:** `.card`, `.tile` (icon, title, stat, description, "Open →" pinned to the bottom),
  `.tabs`/`.tab` with `aria-current="page"`, `.filter-btn` with `aria-pressed`, `.tag` (`direct`,
  `possible`, `helps`, `hurts`, `mixed`, `neutral`), `.meta` for secondary text, `.notice` for
  explanations. One button style pair (`.primary`, `.secondary`), one card style, one link look.
- **Layout:** content in a centred column (`.bills` 860px; wider pages like `.dm` 1080px), equal
  left and right edges, 16px side gutter on phones, grids that collapse to one column under ~760px.
  Never box inside a box inside a box (two levels at most).
- **Icons:** the existing inline Lucide-style SVG strokes (`TAB_ICONS`, `HOME_ICONS`), 2px stroke,
  `currentColor`. No emoji as icons.
- **Charts:** load the `dataviz` skill before drawing any chart; reuse the status colours for
  helps/hurts/mixed.

## 3. Motion: feedback, not decoration

- **Hover (fine pointer only) and press:** a linked card or tile lifts 2px and its border darkens a
  step; a button steps 1px up on hover and sinks 1px (scale .985) on press; links draw an underline.
  150ms in, 120ms out, 90ms press, one ease-out curve (`cubic-bezier(.2,.8,.2,1)`), no bounce.
- **Only transform, opacity and colours move.** Never animate width, height, margin or padding.
- **Nothing reveals on scroll:** no fade-in cards, parallax, carousels, auto-advancing tabs, glows
  or tilt.
- **Signature motion that is allowed:** the member name fly-in, the district fade and the welcome
  fade on the home page, and the setup map's zoom. Keep them short (under ~4 s total) and do not add
  more entrances elsewhere.
- **Reduced motion:** every animation has a `prefers-reduced-motion: reduce` path that shows the
  finished state at once (the name, the map zoom).
- **Never let an animation widen the page:** anything that starts off-screen sits inside a clipped
  box (`overflow-x: clip`), or a phone will scroll sideways.

## 4. Access and phones

- Every control has a visible name; icon-only buttons get `aria-label`. Decorative SVGs get
  `aria-hidden="true"`.
- Headings step down one level at a time; one `h1` per screen.
- Focus is always visible (2px ring in `--accent`, never animated) and never hidden under anything.
- Text contrast at least 4.5:1 (3:1 for large text and UI borders). `--muted` on white passes; do
  not go lighter.
- Tap targets at least 44px tall on phones, 8px apart; form fields 16px text so phones don't zoom.
- Form labels are real `<label for>` elements above fields, never placeholders.
- Live updates (analysis progress, filters) use `aria-live="polite"`.

## 5. Bill Reader rules that must survive any redesign

- **Escape everything:** any value from uploads, AI output, transcripts or the server goes through
  `esc()` (or `textContent`), links through `link()`. No exceptions for "trusted" data.
- **Uploads stay private:** anything showing uploaded bill text or upload briefs keeps the
  `ph-no-capture` class (PostHog replay).
- **Money and consent stay visible:** a paid action always shows the estimate, the hard cap and where
  the text is sent, and stays disabled until the person agrees.
- **Read-only demo:** features that write or spend show an explanation on the public demo
  (`/api/config` → `read_only`), never a broken button.
- **Evidence beside every claim:** a finding shows its bill section and page link; a promise shows
  its source and date; a TV quote shows "Watch at mm:ss". Never strip these for a cleaner look.
- **Honest completeness:** if a brief or list is partial ("98 sections not analyzed", flagged
  statements), say so where the reader will see it.

## 6. Check before calling it done

1. `node --test` passes.
2. Load the changed screen in headless Chrome at **1280 wide and at 390×844 with mobile emulation**
   (Chrome DevTools Protocol `Emulation.setDeviceMetricsOverride` with `mobile: true`); screenshot
   both and look at them.
3. On the phone run, confirm `document.documentElement.scrollWidth` equals 390 after animations
   finish (no sideways scroll) and that there are no page errors.
4. Tab through the screen once: focus visible on every control, in reading order.
5. If the change touches the core flow, walk it end to end: sign in → state → member → district →
   Continue → bill → each tab.
6. Say what you checked, what you could not check, and any rule above you chose to break and why.
