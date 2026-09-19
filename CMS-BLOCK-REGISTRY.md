# CMS-BLOCK-REGISTRY.md

Status: W1 contract · created 2026-09-19

Every block in the registry declares:

```text
type       stable string key
version    integer, bumped on breaking prop changes
label      editor label
props      field schema (see src/lib/cms/blocks.ts)
defaults   initial props for new blocks
```

## W1 set

| type | version | props (required *) | notes |
|---|---|---|---|
| hero | 1 | eyebrow, heading*, body, imageAssetId, ctaLabel, ctaHref, align | semantic purpose, not a card |
| richText | 1 | html* | sanitized on render |
| image | 1 | assetId, alt*, caption | alt required → a11y + readiness |
| quote | 1 | text*, attribution | |
| cta | 1 | heading*, body, buttonLabel*, buttonHref* | |
| featureGrid | 1 | heading, items[] {title*, body, icon} | 1–12 items |
| faq | 1 | heading, items[] {question*, answer*} | emits FAQPage structured data later |
| stats | 1 | items[] {value*, label*} | no invented numbers — AI guardrail |
| divider | 1 | — | |
| spacer | 1 | height | semantic spacing, responsive |
| productGrid | 1 | collectionId*, columns | **W5 shell** — stores ID only, never products |

## Rules

- No "card soup": blocks model semantic purpose (hero, band, grid), not
  visual containers.
- Every breaking prop change requires a version bump + migration entry
  (`migrateBlock`) — planned for W2; documents carry block `version` from day
  one so migrations are possible.
- Commerce blocks may store only IDs + display options. Price, stock,
  availability and product facts come from Sell at render time.
