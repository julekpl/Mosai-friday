# BP-12/S1 — Measurement contract foundation

**Status: in_progress.** This is an English-only, type-level slice of the event and consent contract, not a working analytics collector or a completed chapter.

`src/shared/contracts/measurement.ts` defines canonical event types, minimal properties, denied-by-default consent, and event ID/time validation. It does not collect data, call a tracker, or forward to GA4, Matomo, PostHog or GTM. The first implementation added a public collector that could store events based on a browser-supplied consent flag. A red-first regression exposed that unsafe trust boundary. The collector was disabled in source `de219e0`, then removed from the combined branch in `914346d` because the capability gate forbids public functions in the internal `commerceEvents.ts` file. No public collection API or schema change remains.

The combined branch passed 442/442 unit tests, typecheck, lint with 0 errors/28 existing warnings, public-function and capability audits, the 66-table data-registry audit, and build on code commit `914346d`. The focused measurement contract has one test. No provider, consent UI, real browser consent journey, or live deployment was tested. The full release gate remains red because the tracked secret file fails the existing secret scan.

Next work requires an owner-approved English EU/EEA consent policy, server-owned consent records and revocation, a deduplicated storage/forwarding path, external test properties and proof that denied consent creates zero optional tracking requests. The other 14 requested languages remain deferred until the owner requests them.
