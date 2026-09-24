# BP-19 partial slice — social action setup guidance

**Status:** `implemented_unverified` slice; BP-19 and BP-18 remain open.
**Date:** 24 September 2026.

The social post row previously displayed “connect first” while leaving **Schedule** and **Publish now** clickable. These actions now wait for the server's configured OAuth credential status. When it is loading, disconnected or unconfigured, the controls are disabled and a visible status points to the existing connection section or explains the setup gap. Connected rows retain the existing actions and server-side receipt behavior.

This is an affordance correction, not proof that stored credentials are still valid or that a provider accepted or published a post. Actual account verification, refresh/reconnect, asynchronous publication reconciliation and provider receipts remain BP-08/BP-18 work. No provider was contacted.

**Files:** `src/pages/app/Promote.tsx`, `src/lib/social-post-readiness.ts`, `tests/unit/social-post-readiness.test.ts`.

**Verification:** The loading/disconnected regression failed before the readiness gate and passes now. Focused social tests passed 9/9 in two files, targeted ESLint and `git diff --check` passed. In this checkout, whole-app typecheck exits 2 on the pre-existing missing `three` dependency in `RelationMap.tsx`; the same typecheck passed on the controller's reconciled checkout before this slice. Browser interaction and real provider proof were not run. The overall secret-scan/release gate remains blocked by the tracked historical finding.
