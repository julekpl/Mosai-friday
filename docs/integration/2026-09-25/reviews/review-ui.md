# UI/design-system review: PRs #11-#22 integration

1. [MEDIUM] `src/components/app/create/DraftReport.tsx:43`: source-mode text uses
   raw `text-terminal-green` / `text-terminal-amber` instead of the AA-safe
   `-ink` variants (`text-terminal-green-ink` / `text-terminal-amber-ink`) that
   `index.css:256` explicitly documents as the safe tokens for text, and that
   `NextAction.tsx` and `ModuleGrid.tsx` use consistently. Likely fails
   WCAG 2.2 AA contrast on the soft backgrounds. Fix: swap to the `-ink`
   classes.

2. [LOW] `src/components/app/SinceYouWereAway.tsx:53-56`: only Home block that
   doesn't use `font-mono text-small/text-caption` typography; it uses plain
   `text-sm`/`text-foreground`/`text-muted-foreground`. Visually inconsistent
   next to `NextAction`/`ModuleGrid` on the same page. Fix: match the
   `font-mono text-*` scale used elsewhere.

3. [LOW] `src/components/app/create/DraftDialog.tsx:139-149`: the
   replace/append choice uses bare native `<input type="radio">` elements with
   no visible custom focus styling, while the wizard's `ChoiceTiles.tsx`
   already built an accessible Radix radio-tile pattern with `focus-visible:ring`
   and `min-h-11` targets. Two different radio-selection UIs in the same PR
   set; DraftDialog should reuse `ChoiceTiles` (or at minimum add
   `focus-ring`) instead of bare inputs.

4. [LOW] `src/pages/AppIndex.tsx:82` (`FirstRunWelcome`): builds
   `className={`grid size-10 shrink-0 place-items-center rounded-lg ${step.tile}`}`
   with a raw template literal instead of `cn()`, the only spot in the
   reviewed files not going through `cn`. Cosmetic only, but breaks the
   pattern used by `ModuleGrid`/`NextAction`.

5. [OK: no hex or arbitrary px] `grep -nE '#[0-9a-fA-F]{3,6}|\[[0-9]+px\]'`
   across wizard/*, kit/*, ThisWeekNextStep, NextAction, ModuleGrid,
   create/DraftDialog, DraftReport, SourcesPanel, AppIndex returned nothing -
   all color/spacing values go through tokens.

6. [OK] Status UI: `NextAction.tsx` correctly imports and uses `StatusBadge`
   from `module-kit.tsx`. `DraftReport.tsx` and `SourcesPanel.tsx` render
   source-truth state (full/excerpt/omitted) as plain text+color rather than
   `StatusBadge`/`ReceiptBadge`: reasonable since it isn't a connect/publish
   status, but if it ever needs a badge affordance, reuse `StatusBadge`
   rather than inventing new color logic (see #1).

7. [OK] `ChoiceTiles.tsx` is a good shared radio-tile primitive (Radix root,
   44px targets, visible focus ring, `aria-labelledby`/`aria-describedby`) -
   this is the pattern DraftDialog (#3) and any future picker should adopt
   instead of a new one-off.

8. [OK] Loading/empty/locked states present: `ModuleGrid` has
   `ModuleGridSkeleton` (loading), `ModuleEmpty` (locked/no-modules) with a
   `role="status"` skeleton; `ThisWeekNextStep`/`NextAction` has
   `NextActionSkeleton`; `SinceYouWereAway` renders nothing when there's
   nothing to show (correct "no fake content" empty state) and uses
   `role="status" aria-live="polite"` for the announcement.

9. Blueprint reuse note: the Camera Coach blueprint
   (`scratchpad/blueprints/d8f0ec50-...MEDIA-BLUEPRINT.md`) and Futureproof
   Agent blueprint (`b1a9d4db-...AGENT-BLUEPRINT.md`) both propose new
   components (`MediaLibrary`/`AuthenticityBadge`, `ReadyCard`/`NeedsYou`).
   None of these exist yet in `src/components/app/`. When built, they should
   reuse: `StatusBadge`/`ReceiptBadge` (module-kit.tsx) for
   authenticity/ready state instead of inventing new badges, `ModuleEmpty`
   for empty/locked states, and the `TILE_CLASSES`/`tile-*-soft/-ink` token
   pattern from `ModuleGrid.tsx`/`NextAction.tsx` for icon tiles: not new
   hardcoded color pairs.

10. [OK] Duplication check: `ChoiceTiles` (wizard) vs `ModuleGrid` cards vs
    kit cards serve genuinely different shapes (radio choice vs navigation
    tile vs status card): no problematic duplication found, only the
    DraftDialog radio gap noted in #3.
