# BP-11 journey-origin slice — 23 September 2026

Status: **partial implementation; BP-11 is not complete**. Base: GitHub main `93a0df20ce5bf9568bcf5a2ebbed6080894a32f4`. Branch: `codex/bp-11-journey-origin` in the existing `review-current` checkout.

A successfully generated AI journey now retains its AI origin after the generation spinner ends and saves with `source: "ai"`; manual and CSV-created journeys retain their respective origins. The journey list uses clear labels: “AI draft,” “CSV import,” and “Manual.” Editing an existing journey does not change its stored origin. Previously the create handler checked `busy` at save time, after generation had reset it, so an AI draft was saved as manual.

Verification: a red-first source helper test failed before implementation; focused tests passed 3/3 afterward, including Convex create/edit preservation for AI, manual and CSV. The controller independently ran the full unit suite: 336/336 passed with `BUN_BIN` set. Focused ESLint and `git diff --check` passed. Whole-app typecheck remains blocked in this checkout by seven pre-existing missing-`three` errors in untouched `RelationMap.tsx`. No browser journey or provider call was run for this slice.

Remaining BP-11 work includes reviewed source/fact references, evidence-linked and assumption-labeled persona claims, structured journey happy paths/gaps/outcomes, and immutable approved-content versions reused by another module. The blueprint's `tests/e2e/base-journey.spec.ts` is still absent. This local origin correction is not proof of the full journey.
