# WEBSITE-EXECUTION-PLAN.md

Status: W0 contract · created 2026-09-19

## W1 — CMS foundation (this implementation)

Delivered in the Build module as a first-class **Site** surface:

```text
Build module
└ Site
  ├ Overview   site health: published/draft counts, last publish
  ├ Pages      tree, create, edit, publish, archive, redirects
  ├ Navigation menus with page|external items
  ├ Assets     canonical asset references
  ├ Redirects  manual + auto-created on path change
  └ Settings   site name, SEO defaults, homepage, 404 note
```

Page editor: structured block editor (add / reorder / edit / delete blocks),
autosave to draft (never publish), preview render, publish diagnostics
(blocking vs recommendations), version history with restore-as-draft.

## Acceptance criteria (from blueprint §133)

1. A Site has a homepage. ✓ (homepage pageType, settable)
2. URLs are unique and hierarchical. ✓ (slug + parentId → fullPath, unique check)
3. Editing a published page creates a newer draft. ✓
4. Draft changes do not appear publicly. ✓ (published reads resolve
   publishedRevisionId only)
5. Published revision is immutable. ✓ (publish writes a new revision; patch
   of published revisions is refused)
6. Previous version can be restored as a new draft. ✓
7. Page deletion/archive handles incoming links. ✓ (publish-time link check)
8. URL change can generate a redirect. ✓ (auto-offered on published path change)
9. Asset references are stable IDs. ✓ (assetId references in blocks)
10. Broken required references block publish. ✓ (diagnostics)
11. SEO defaults + per-page override both work. ✓
12. Navigation references real page IDs. ✓ (typed items, validated)
13. Public reads never return draft accidentally. ✓ (single resolver)

## Next milestones

- W2: Puck spike against serialized PageDocument; adopt if the six spike
  questions pass (serialization, external data, locked components, nested
  layouts, viewports, migrations).
- W3: public runtime + domains (independent hosting layer).
- W4: FormDefinition + submission → Customers contact/consent/activity.
- W5: commerce blocks resolve collectionId → live Sell data.
