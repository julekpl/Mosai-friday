# UI component plan for the four blueprints (Discovery, Camera/Media, Futureproof Agent, Country/Market)

Scope: no new libraries, no paid assets, tokens only. Checked against
`main` at this checkout (2026-09-25).

## 1. Existing reusable inventory (file:line)

- `src/components/app/module-kit.tsx`: `StatusBadge` (:66), `SourceChip`
  (:97), `Stat` (:127), `SectionHeader` (:181), `ConfirmDelete` (:243),
  `ModuleSkeleton` (:314), `ModuleErrorState` (:357), `RelatedModules`
  (:434), `ModuleEmpty` (:478), `DATA_PROVIDERS` (:527). This is the base
  kit for every module surface: status, empty, loading, error already
  solved here.
- `src/components/app/NextAction.tsx` + `next-action-model.ts`: "what to do
  next" card pattern, already uses `StatusBadge`, `tile-*-soft/-ink` token
  pairs, has a skeleton (`NextActionSkeleton`, per review-ui.md #8).
- `src/components/app/ReceiptBadge.tsx`: provider-receipt-backed status
  (connected/sent/paid truth states, AGENTS.md rule 5).
- `src/pages/AppIndex.tsx` `FirstRunWelcome` (:60-110): onboarding welcome
  card, tile icon pattern, font-mono type scale: closest existing analog
  to a "discovery confirm card."
- `src/pages/app/Overview.tsx`: current Home; 1256 lines, module grid +
  next-action composition live here (no separate `SinceYouWereAway.tsx` /
  `DraftReport.tsx` files exist in this checkout: see §3).
- `src/components/ui/`: `dialog.tsx`, `sheet.tsx`, `tabs.tsx`,
  `radio-group.tsx`, `progress.tsx`, `skeleton.tsx`, `sonner.tsx` (toast),
  `card.tsx`, `badge.tsx`, `empty.tsx`, `item.tsx`: the Radix/shadcn
  primitive layer everything above is built on.
- Radio-tile pattern: review-ui.md (#3, #7) documents a `ChoiceTiles.tsx`
  wizard component (Radix radio root, 44px targets, visible focus ring,
  `aria-labelledby`/`aria-describedby`) as the canonical accessible
  radio-choice UI: not present in this checkout's `src/` (only referenced
  in the prior review), so treat it as the pattern to re-establish, not
  reinvent, wherever a new picker needs radio-style choice.
- Icon-tile colour system: `tile-*-soft` / `tile-*-ink` token classes used
  by `ModuleGrid`/`NextAction`/`AppIndex`: the one allowed way to colour a
  status or category tile.

## 2. New surfaces vs. component plan

### Discovery confirm card (Organisation Discovery blueprint, high/medium
confidence paths)
- Reuse: `SectionHeader` + `StatusBadge` (confidence as "Confirmed" /
  "Estimated", never a raw percentage: no new badge language) +
  `ConfirmDelete`-style two-button footer pattern (module-kit.tsx:243) as
  the shape for a confirm/edit footer.
- New: a thin `DiscoveryConfirmCard` wrapper only if no existing card
  fits; body content (business name, category, one ambiguity field) is
  plain `Card`/`Field`/`Label` from `ui/`.
- States: loading (`ModuleSkeleton`), empty/low-confidence (`ModuleEmpty`
  routes to manual entry, per blueprint "low -> ask website/name"), error
  (`ModuleErrorState`), success (confirmed, writes `market.confirmed.v1`-
  style event), locked n/a.
- Mobile @360px: single column, full-width buttons stacked, card padding
  reduces to token `p-4`.
- A11y: `role="group"` with `aria-labelledby`, confirm/edit buttons
  `min-h-11`, focus lands on the card heading on mount, `aria-live="polite"`
  region for "estimated -> confirmed" transition.
- Tokens: `tile-*-soft/-ink` for the confidence icon only if one is used;
  otherwise text-only, no new colour pair.

### "For you now" / Needs You / Ready For You lists with "Why this?"
(Futureproof Agent blueprint, `src/components/agent/NeedsYou.tsx`,
`ReadyCard.tsx`, `ReadyForYou.tsx`, `WhyThis.tsx`, `AgentProgress.tsx`)
- Reuse: `NextAction.tsx`'s card shape is the direct precedent (icon tile,
  title, one-line rationale, CTA): build `NeedsYou`/`ReadyCard` as
  siblings of `NextAction`, not a new visual language. `StatusBadge` for
  state chips ("waiting on you" / "ready"). `ModuleEmpty` for "nothing
  needs you right now."
- New: `WhyThis.tsx` is justified: nothing today shows a short rationale
  disclosure. Keep it a `Popover`/`Collapsible` (both already in `ui/`)
  triggered from a plain-text "Why this?" link, not a new tooltip system.
  `AgentProgress.tsx` should extend `progress.tsx` + `StatusBadge`
  wording ("queued/running/waiting_for_user/succeeded/partially_succeeded/
  failed/canceled" per AGENTS.md rule 13) rather than inventing a new
  progress ring or percentage meter.
- States: loading (`ModuleSkeleton`), empty ("Ready for you" with nothing
  queued -> `ModuleEmpty`), error (`ModuleErrorState` with retry), partial
  (`partially_succeeded` -> `StatusBadge` variant + inline note, not a
  separate partial component), success, locked (plan-gated -> `ModuleEmpty`
  locked variant already supports this per review-ui.md #8).
- Mobile @360px: cards stack full-width; `WhyThis` popover must not
  overflow viewport (use Radix `collisionPadding`).
- A11y: list has `role="list"`, each card is a `role="listitem"`; "Why
  this?" trigger is a real `<button>` with `aria-expanded`; list-changed
  announcements via one shared `aria-live="polite"` region at the list
  root, not per-card, to avoid announcement spam.
- Tokens: reuse `tile-*-soft/-ink` category colours already defined for
  modules (persona/journey/content/etc.) so a "Ready" item in Create uses
  the same tile colour Create already uses elsewhere.

### MediaPicker (tabs + quality nudge + before/after compare)
- Reuse: `tabs.tsx` for "Your photos / From your website / Stock photos"
  (ticket MD-0). `dialog.tsx` or `sheet.tsx` (sheet on mobile) as the
  picker shell. `ModuleSkeleton`/`ModuleEmpty`/`ModuleErrorState` per tab.
  Grid items follow the same tile/card sizing as `ModuleGrid`.
- New: `MediaPicker.tsx` itself is the justified new component (ticket
  MD-0, `src/components/app/media/`); a before/after compare control is
  also justified: nothing today does image compare. Build it as a plain
  two-image `<figure>` pair with a `toggle-group.tsx` ("Before"/"After")
  switch, not a custom slider widget: simplest, keyboard-operable, no new
  gesture code.
- Quality nudge: per blueprint (line ~601, ~1375-1385) explicitly "do not
  expose score" and avoid "Photo score: 42/100." Use `StatusBadge`-style
  outcome language only: "Ready" / "Usable" / "Retake recommended", with
  the reason as plain text ("Too dark", "Heavy blur") in an
  `aria-live="polite"` region next to the thumbnail, matching MD-2a's own
  planned copy ("This photo looks a little dark. Use it anyway, or try
  another?"). No numeric meter, no star rating.
- States: loading (upload/processing -> `ModuleSkeleton` + `processing`
  status text), empty (no photos in a tab -> `ModuleEmpty`), error (upload
  failed -> `ModuleErrorState`), partial (some variants generated, others
  pending -> per-item `StatusBadge`), success (selected + inserted),
  locked (stock photos on a plan without access -> `ModuleEmpty` locked).
- Mobile @360px: tabs scroll horizontally if needed (`tabs.tsx` already
  supports overflow); grid drops to 2 columns; picker uses `Sheet` (bottom
  sheet) instead of centered `Dialog` under a `sm:` breakpoint.
- A11y: tab panel focus management from `tabs.tsx` (already Radix, free);
  thumbnails are real buttons with `aria-label` (filename + status, not
  just "image"); 44px minimum tap target on grid items and the
  before/after toggle.
- Tokens: no new colour; reuse `StatusBadge` tone tokens for
  ready/usable/retake.

### Camera capture button
- Reuse: plain `Button` (`ui/button.tsx`) with an existing icon; per
  ticket MD-3 this is `<input type="file" accept="image/*"
  capture="environment">` feeding the same upload path: genuinely no new
  visual component needed, just a label ("Take a photo") and a static
  per-role checklist rendered as plain text list, not a new checklist
  component.
- States: hidden/falls back to normal upload where `capture` unsupported
  (feature-detect, no broken affordance): this is the "unavailable" case,
  render nothing extra rather than a disabled button with no explanation.
- A11y: button carries `aria-label="Take a photo with your camera"`; no
  camera permission prompt of MOSAI's own (per blueprint line ~516-527) -
  the browser's native prompt is the only one shown.
- Tokens: standard `Button` variant, no new colour.

### Market row in Settings
- Reuse: existing `ProjectSettings.tsx` row pattern (ticket MK-3 already
  specifies this) + `StatusBadge` for "Confirmed" vs "Estimated": exactly
  the kind of state `StatusBadge` was built for, no new component.
- States: loading (row skeleton matches other settings rows), empty/unset
  (market unresolved -> row shows "Not set" plain text, no badge),
  error (`market.confirm` rejection -> inline field error via `Field`/
  `form.tsx`), success (badge flips to Confirmed + toast via `sonner.tsx`).
- A11y: row is a standard `Field`+`Label` group; country/currency/language
  selects use `select.tsx`; confirm button `min-h-11`.
- Tokens: none new.

### Capability progress / working state (agent jobs, MD-2a processing,
AG-4a runs)
- Reuse: AGENTS.md rule 13's fixed state vocabulary (`queued, running,
  waiting_for_user, succeeded, partially_succeeded, failed, canceled`)
  mapped straight onto existing `StatusBadge` tones: do not invent a new
  "in progress" spinner language per surface. `spinner.tsx` for the
  `running` glyph, `progress.tsx` only where there's a real determinate
  fraction (e.g. N of M media variants generated), never a fake animated
  percentage.
- States: all seven above are the full state set; `waiting_for_user` must
  route to the specific "Needs You" affordance above rather than a generic
  spinner.
- A11y: state changes announced via one `aria-live="polite"` region per
  job card, not the whole page.
- Tokens: `StatusBadge` tone tokens only.

## 3. Visual consistency check on Home / Create (current `main`)

- `src/components/app/SinceYouWereAway.tsx` and
  `src/components/app/create/DraftReport.tsx` / `ChoiceTiles.tsx` /
  `DraftDialog.tsx`, named as fixed/flagged in the prior review
  (`docs/integration/2026-09-25/reviews/review-ui.md`), do **not exist**
  in this checkout's `src/` tree: `find`/`grep` across `src/` return
  nothing for any of the four names. Either those PRs were not merged
  into this branch or the files were later renamed/removed. Flag for the
  owner to confirm which is true before relying on the earlier review's
  "now fixed" status: do not assume the fix landed here.
- Checked what does exist: `src/pages/AppIndex.tsx` (onboarding/welcome)
  and `src/pages/app/Overview.tsx` (Home). `grep -rnE
  '#[0-9a-fA-F]{3,6}|\[[0-9]+px\]'` across `AppIndex.tsx`, `Overview.tsx`,
  `Create.tsx`, `module-kit.tsx`, `NextAction.tsx` returns nothing: no
  raw hex or arbitrary-pixel classes in the current Home/Create files.
  `AppIndex.tsx` consistently uses the `font-mono text-h1/text-small/
  text-caption` scale (lines 47, 63-67, 83-103), matching module-kit
  conventions. No drift found in this pass; re-run the same grep after
  the four blueprints' PRs land, since new surfaces are the actual risk.

## 4. Polish checklist per new surface

**Discovery confirm card**: microcopy is declarative, no exclamation
marks ("We found your business" not "We found your business!"); motion:
fade/slide-in via existing `tw-animate` utility classes already used by
`dialog.tsx`/`sheet.tsx`, nothing bespoke; empty/low-confidence state has
no illustration: text + a manual-entry button only (no paid/stock art).

**Needs You / Ready For You / Why this?**: microcopy is second-person,
short ("Needs you: confirm your homepage headline"), never "AI has
detected..."; list-appear motion reuses the card enter animation already
in `ModuleGrid`; empty state ("Nothing needs you right now") is text +
existing `ModuleEmpty` icon tile, no new illustration.

**MediaPicker**: nudge copy stays helpful, never shaming (blueprint is
explicit: no "Photo score: 42/100"); tab-switch and before/after toggle
use existing `tw-animate` fade/slide utilities only; empty tab state
("No photos yet") uses `ModuleEmpty`'s existing icon-tile pattern, not a
custom drawing.

**Camera button**: copy is one line ("Take a photo"), checklist below it
is plain text bullets, no icon-per-bullet unless reusing an existing icon
set already imported elsewhere; no motion needed beyond the button's
existing hover/focus states.

**Market row**: copy avoids jargon ("Estimated from your website" not
"Inferred via reconciliation engine"); no motion beyond the existing badge
tone transition; no illustration.

**Capability progress**: copy names the outcome, not the mechanism ("Building your homepage" not "Running content.gaps.detect.v1"); `spinner.tsx`'s existing animation is the only motion; failed/partially_succeeded states get one concrete next step in text, never a bare "Error."

## Summary of what needs a token-consistent alternative (per blueprint
authors' own instruction, not just this review)

- Authenticity badge -> `StatusBadge` tone, no new badge visual.
- Confidence meter / score -> outcome words ("Ready"/"Usable"/"Retake
  recommended", "Confirmed"/"Estimated"), never a number or star rating.
- Quality score -> same outcome-word treatment; reason as plain text.
