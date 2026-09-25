# Brand system — how MOSAI captures and uses a brand

**Added:** 25 Sep 2026. **Code:** `src/convex/lib/brandProfile.ts` (pure),
`projects.saveBrandProfile` / `storeBrandProfileDraft` / `brandProfileForAction`,
`ai.generateBrandProfile`, `ai.checkBrandFit`, `ai.generateComms`,
`guards.buildContextPack`, `src/components/app/BrandKitForm.tsx`.
**Tests:** `tests/unit/brand-identity.test.ts`, `tests/e2e/project-mobile.spec.ts`.

## Problem it fixes

1. Prompts told the model to "match the brand voice of the business", but no
   brand voice existed anywhere in the data model.
2. Marketing communications were a dead end. `communications.create` always
   wrote `draft`, the UI could only archive or restore, and no AI prompt ever
   read the table. They had no effect on any output.
3. The data model held no visual identity (colours, type, imagery), so the
   website and app builders could not stay on brand.

## Simple on the surface

Edit project → **Brand**. There are three plain-language groups and one tool:

| Group | What the owner sees | What sits behind it |
|---|---|---|
| What you say | Promise, "why you", key messages with proof | Positioning (Dunford) + messaging house (roof / pillars / foundation) |
| How you sound | Four 1–5 scales, personality chips, do/don't chips, words to use/avoid | NN/g tone dimensions; voice-vs-tone split (Mailchimp) |
| How you look | Colour pickers, fonts, corners, imagery | WCAG 2.2 contrast checks; W3C DTCG 2025.10 token export |
| Check a piece of copy | Paste text → score, issues, on-brand rewrite | Deterministic lint + `brand.voice_reviewer` agent |

"Draft it for me" fills everything from the business profile, personas and
website evidence. Before confirmation the kit is shown as **Draft — please
review**; the first "Save and confirm" makes it **Confirmed by you**. An AI redraft
never overwrites a confirmed kit without an explicit owner confirmation.

On Overview, a **Your brand** card shows the promise, personality and colour
swatches. Each marketing communication now has a **Used by AI** switch
(`draft` ↔ `active`).

## Powerful underneath

- **One wiring point.** `buildContextPack` appends `brandBriefLines(brand,
  activeMessages)` to `businessBrief`. Every agent that reads the brief
  (content, topics, gaps, personas, journeys, social copilot, website/app
  builder, build plan, Sell) receives the kit with no per-feature changes.
  Projects without a kit get an empty list, so their prompts do not change.
- **Claims rule.** AI may state only facts that appear in proof points or
  evidence. Proof points are the only place a number, award or guarantee can
  come from.
- **Shared grounding rule.** `AUDIENCE_AND_SUBJECT_RULES` gained one line: follow
  the BRAND KIT's voice, words and claims rule. Brand rules never override the
  audience grounding.
- **Active messages only.** Only `active` communications (at most 5) reach
  prompts. Drafts stay private until the owner switches them on.
- **Creative brief.** `generateComms` now produces a single-minded message,
  the key message it supports, proof points (never invented), the desired
  response (think / feel / do) and a call to action. All fields are optional and
  additive in the schema.
- **Honest states.** `checkBrandFit` returns `needs_setup` when there is no kit
  and never calls the model in that case.
- **Safety.** Colours are stored only as `#rrggbb` and fonts only as plain family
  names, so neither can inject CSS. Pasted copy is labelled as data, never as
  instructions. Every function checks project access, and the cross-tenant tests
  cover the new functions.

## Round 2 (25 Sep 2026): AI on every field, visual controls, per-module switches

**Simple on the surface**

- **AI on every text field.** "Write with AI" (empty) / "Improve" (filled) opens
  three options, with one-tap requests (Shorter, Simpler, Bolder, Warmer, More
  specific) or a free-text ask. Nothing is saved until the owner picks and saves.
- **Key messages with AI.** "Suggest key messages" proposes 3–4 pillars tied to
  the promise; each has Improve buttons and **Find proof in my website**
  (evidence-only, low temperature, empty rather than invented).
- **Starter chips** for personality, write-like/never-like, avoid-words and
  imagery, plus "Suggest" (AI, specific to the business) on every chip list.
- **Voice.** Six personality presets set all four scales at once. Each scale is a
  five-stop track (an ARIA radio group with arrow keys) with the current setting
  named ("Quite casual") and a live example sentence for that point.
- **Look.** Visual corner choices; a live mini-page preview in the brand's
  colours, fonts and corners; eight mood palettes; "Build a palette from your
  main colour" (contrasting / harmonious / vibrant / one colour); "Suggest
  palettes for my business" (AI); fine-tuning tucked behind a disclosure.
- **Readability check** covers colours and fonts: **Fix it for me** darkens only
  the failing colours (hue kept), and font advice flags display faces used for
  body text and gives the WCAG 1.4.12 spacing guidance.
- **Fonts** are recommended from personality, voice and corners (with the
  reasons shown), previewed in the real typefaces, and "Ask AI for more
  pairings" adds three more.
- **Where AI uses your brand**: one switch per area (Content, Social, Website
  and app, Product copy, Customer research). Each module header shows a chip
  ("Brand on" / "Brand off here" / "No brand yet") linking back to the switch.

**Powerful underneath**

- `lib/brandDesign.ts` (pure): HSL palette generation, `fixReadability`
  (lightness-only repair to 4.5:1 text and 3:1 accent), `cleanPalette` for AI
  output, `recommendFonts` (owner-picked traits weigh 3, voice-inferred 2,
  shape bonus), `fontAdvice`, `googleFontsHref` (plain family names only).
- `projects.brandUse` + `projects.setBrandUse`. `brandBriefLines(..., use,
  settings)` returns nothing for a switched-off area (active messages
  included). Colours, fonts and imagery go only to website and social prompts.
  **Customer research is off by default** so personas and journeys stay
  neutral instead of echoing the brand's own claims.
- Every `actionContextPack` call names its area: Create → content, Promote →
  social, Build (site chat, plan, page drafts, app builder) → website, Sell →
  shop, Understand/Journeys → research; brand agents use `all`.
- The app builder now applies brand colours (Tailwind arbitrary values), Google
  fonts (one `@import` in `src/index.css`) and corner style when the website
  area is on.
- `ai.brandAssist` (agent `brand.assistant`): one action for text options, list
  suggestions, key messages, palettes (contrast-repaired) and font pairings
  (plain names only). The current value and the owner's request are labelled
  user data.

## Agents

| Agent id | Job | Autonomy |
|---|---|---|
| `brand.identity_strategist` | Draft the whole kit from the brief and evidence | assistive (owner confirms) |
| `brand.voice_reviewer` | Score copy, quote problems, rewrite on-brand | assistive |
| `brand.assistant` | Draft or improve any brand field; palettes; font pairings; evidence-only proof | assistive (owner picks) |
| `create.communication_generation` | One creative brief per message (upgraded) | assistive |

## Open question for the owner (AGENTS.md §7)

Applying brand colours and fonts to **published** public websites
(`lib/siteHtml.ts` `STYLE`, `--accent` etc.) would change what customers see
live, so it is **not** done here. The kit already exports validated tokens,
and `normalizeHex` makes a colour safe to place in CSS.
Recommendation: map `primary`→`--accent`, `on-primary`→`--accent-text`,
`dark`/`light`→`--text`/`--bg` for sites whose owner opts in, and keep a
fallback to the current palette whenever a contrast check fails.

## Sources

- Nielsen Norman Group, *The Four Dimensions of Tone of Voice* — https://www.nngroup.com/articles/tone-of-voice-dimensions/
- Mailchimp Content Style Guide, *Voice and Tone* — https://styleguide.mailchimp.com/voice-and-tone/
- April Dunford, *A Quickstart Guide to Positioning* — https://www.aprildunford.com/post/a-quickstart-guide-to-positioning
- The Branding Journal, *Messaging house* — https://www.thebrandingjournal.com/2025/03/the-strategic-advantage-of-a-messaging-house-for-your-brand/
- W3C WAI, *Understanding SC 1.4.3 Contrast (Minimum)* — https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- W3C Design Tokens Community Group, *first stable version (2025.10)* — https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
