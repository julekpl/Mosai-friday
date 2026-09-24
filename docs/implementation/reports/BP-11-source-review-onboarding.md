# BP-11 partial slice — honest source status and listing confirmation

**Status:** `implemented_unverified` slice; full BP-11 remains in progress.
**Date:** 24 September 2026.

When project setup requested both a website scan and Google Business lookup, one failed source was previously hidden behind a successful aggregate status. The wizard now shows each source's outcome and records `partial` when only one succeeds. A Google Maps search result is treated as a candidate: the customer sees its name, address and website and must choose **Use this listing** before its fields are added to project context. **Not my business** leaves those fields out. An empty requested business name is caught before lookup.

The customer can still create a project when a source fails and supply details manually. The scope is the onboarding UI and status logic; it does not establish source identity verification, persisted field-level provenance, or a complete BP-11 journey. No real SerpApi or website call was made during verification.

**Files:** `src/components/app/NewProjectWizard.tsx`, `src/lib/project-scan-status.ts`, `tests/unit/project-scan-status.test.ts`.

**Verification:** The mixed-source regression first failed with `expected 'scraped' to be 'partial'`; the unconfirmed-candidate regression first failed with `expected 'failed' to be 'partial'`. After the fixes, focused status tests passed 4/4, full unit suite passed 389/389, `bun run typecheck` passed, targeted ESLint passed, `bun run build` passed, and `git diff --check` passed. The configured secret scan remains blocked by the pre-existing tracked `.env.keys` finding; no release claim follows from these checks. Browser interaction against a real test project and provider-result matching remain unverified.
