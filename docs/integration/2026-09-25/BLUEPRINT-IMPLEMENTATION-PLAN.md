# MOSAI blueprint implementation plan (AGENT, DISCOVERY, MEDIA, MARKET)

Supervising architect, 25 Sep 2026. Inputs: plan-agent.md, plan-discovery.md,
plan-media.md, plan-market.md, INTEGRATION-PLAN.md (binding except where
section 7 corrects it), AGENTS.md, current `main` at `a5b4255` (starter-kit
stack merged; #19, #13, #22 not yet merged: no `src/shared/sinceLastVisit.ts`,
no `src/components/app/create/`). Claims marked (verified) were re-read in
`main/` for this plan.

---

## 1. Executive summary

Build, in this order: finish the merge train; land one shared contracts file
(CT-1) and one ADR (CT-2); ship the Home "For you now" list and run U12 on it;
then three lanes in parallel: a thin agent spine (events table, capability
registry, one wrapped capability), the media library (picker, schema, quality
check, crop presets, camera via file input), and a narrow market context
(resolved country/currency/locale, CLDR, Settings row). Discovery is built
only if U12 shows first-run friction, and ships with no paid provider.

| Blueprint | Verdict | Build now | Cut or deferred |
|---|---|---|---|
| AGENT | Right direction, overbuilt | AG-1 events + runs tables, AG-2 registry, AG-3 `modelClass`, AG-4a `business.understand.v1` | Convex Workflow (D7), autonomy widening, Phases D-G, AG-4b/c until AG-4a proves value |
| DISCOVERY | Mostly already shipped (wizard `readSources`) | OD-1 resolver on own site/email domain, OD-2 confirm card (U12-gated), OD-4 manual benchmark | OD-3 provider until D3/D5/D11; person enrichment, disambiguation picker |
| MEDIA | Good core, heavy scaffolding | MD-0 picker, MD-1 schema, MD-2a quality check, MD-2c crop presets, MD-3 camera via `<input capture>` | Live CV coach, video, generative/Canva, pixel provider (MD-2b until D4), `mediaUsage` table, `getUserMedia` UI |
| MARKET | 90 percent cut | MK-1 `marketContext`, MK-2 CLDR, MK-3 Settings market row, MK-4 Big Five label | Population priors, WVS/EVS (D6), World Bank cache (MK-5, deferred), OD confirm-card market line |

---

## 2. Review findings

### 2.1 Verified code facts that shape every plan
- `ContextEvidence {ref, version, source, title, trust, text, truncated?}` and
  `ContextTrust = "workspace_entry"|"untrusted_source_text"|"provider_data"`
  live in `src/convex/lib/contextPack.ts:3-14` (verified). CT-1 moves
  `ContextTrust` to `src/shared/contracts/provenance.ts`; `contextPack.ts`
  re-exports it so there is one definition.
- `AiAutonomy = "assistive" | "draft"` at `modelGateway.ts:16`, `model?:
  string` at `:41` (verified). `aiRuns.autonomy` is a two-literal union at
  `schema.ts:2132` (verified), so any autonomy widening is a schema change.
- `projectFiles` (`schema.ts:1089-1112`, verified): `storageId`, `mimeType`,
  `sizeBytes`, `excerpt`, `uploadedBy`, `source: upload|owner_site|stock`,
  Pexels-only `attribution`, index `by_project`. No kind/role/dimensions.
- No `sharp`, no image decoder, no `node.externalPackages` in `convex.json`,
  no `convex.config.ts` (verified). Convex documents `externalPackages` for
  native modules, so Sharp is possible but unproven here; a 1-day spike
  (MD-S) is the honest answer, not "impossible" and not "default yes".
- Starter-kit statuses already include `canceled` (`src/shared/starterKit.ts:51-70`,
  verified) but nothing writes it: no cancel mutation. The integration plan's
  "add the missing `canceled` state" is really "add a cancel path" (KIT-1).
- `dataRegistry.ts` has `project()`, `user()`, `global()` helpers and
  `bun run check` runs `audit:data-registry` (verified, `package.json:27`).
  Project-cascade deletion requires a `projectId` field and `by_project`
  index on every project table.
- `projects.saveScan` is an `orgMutation` that writes client-supplied
  `scanFields` into `projects.websiteScan` (`projects.ts:370-376`, verified),
  and `importOwnerPhoto` re-validates picked images against that same
  client-written list. The scan later grounds AI calls: this bends AGENTS
  rule 3. A server writer already exists (`storeServerScan`,
  `projects.ts:380`). New ticket SEC-1.
- `scanWebsite` is an authenticated `action` (`scraping.ts:178`, verified);
  `projects.websiteScan.businessDetails` already carries `address` and
  `country` (`schema.ts:~360`), which is MK-1's first-party country source.
- `docs/pack/08-module-contracts.md` does not exist; `src/shared/contracts/`
  holds `status.ts` and `measurement.ts` (verified). No `featureFlags.ts`.
- CT-1 and CT-2 appear only in INTEGRATION-PLAN.md (grep of `docs/`,
  verified): they were referenced by three plans but owned by none. This plan
  owns them (section 4).

### 2.2 Per blueprint
**AGENT.** Right: registry naming, versioned ids, job-table pattern.
Overbuilt: six tables plus Workflow component in Phase A; five wrappers in
one ticket; autonomy tiers with no approval gate. plan-agent is sound but
adds AG-0 (duplicates CT-2), puts `provenance.ts` in AG-2 (it is CT-1), and
ships `domainEvents` with no emitter. Fix: AG-1 emits `project.created.v1`
from `projects.create`/`createClientProject` so the table is exercised.
`act_external` must not exist as a value until an approval ticket exists
(AGENTS rule 5): drop the autonomy widening from AG-3.

**DISCOVERY.** Right: plan-discovery correctly finds the wizard already does
website/listing discovery (`NewProjectWizard.tsx` `readSources`). Wrong:
folder `src/convex/organization/` and id `organization.resolve.v1` collide
with the glossary (Organization = billing/team); rename to
`src/convex/discovery/` and `business.resolve.v1`. The domain-keyed shared
cache in OD-1 would let one account's candidate row be served to another
(its own OD-5 warns about this): key by `(userId, domain)`. OD-2 adds a
`projects` field inside a UI PR (AGENTS section 8): move it to OD-1. OD-4
"runs in CI" would crawl live sites in CI: make it a manual script. OD-5
folds into OD-1; OD-6 is ordinary definition-of-done, not a ticket.

**MEDIA.** Right: `projectFiles` as canonical row, `mediaLibrary/` folder,
`stock.ts` as the template, check-before-transform. Overbuilt: `mediaUsage`
table with no writer; MD-2b no-op provider interface before D4; MD-3 moved
from the integration plan's file-input capture to `getUserMedia`, which adds
permission UX, device risk and a new owner decision for no user gain on
phones (`<input type="file" accept="image/*" capture="environment">` opens
the native camera). Defect: `mediaUsage` "by_project via join" cannot pass
the registry's project-cascade rule. MD-2a adds schema fields in a second PR;
fold them into MD-1 so there is one schema PR.

**MARKET.** Right: the cut, CLDR as best value per line, `bigFive` labeled
`inferred`. Wrong: MK-1 depends on "OD-2 confirmed address", which OD never
produces (candidate has name, website, type); the real sources are the
scan's `businessDetails.country`, the Google listing and the confirmed
`businessProfile.market`. MK-2 invents a fourth `ContextTrust` value locally;
CT-1 defines it once (`reference_data`). The confirm-card market line couples
Wave 5 and Wave 6 UI and breaks the 2-screen cap: Settings only. MK-3 World
Bank cache (renumbered MK-5) is deferred per plan-market's own MKD-1.

---

## 3. Shared contracts (single source)

`src/shared/contracts/provenance.ts` (CT-1; dependency-free, like `status.ts`):

```ts
export type ContextTrust =
  | "workspace_entry" | "untrusted_source_text" | "provider_data"
  | "reference_data"; // code-owned static data (CLDR); never user text

export type EvidenceRef = {
  sourceType: "contextPack" | "projectFile" | "websiteScan" | "googleListing"
    | "provider" | "reference" | "user_edit" | "artifact";
  sourceId: string;      // row id, contextPack ref, or reference key
  version?: string;      // contextVersion()-style hash
  retrievedAt?: number;
  url?: string;          // only for sources fetched through safeFetch
  trust: ContextTrust;
};

export const AUTHORITY_ORDER = [
  "user_confirmed", "accepted_artifact", "first_party", "provider",
  "public_source", "population_prior", "inferred",
] as const;
export type Authority = (typeof AUTHORITY_ORDER)[number];

export type SourcedValue<T> = {
  value: T; authority: Authority; evidence: EvidenceRef[];
  confidence?: number; observedAt?: number;
  locked?: boolean; // only valid with authority "user_confirmed"
};

export type WriteDecision = "write" | "skip" | "suggest";
/** Lower tier never overwrites higher. A first_party contradiction of a
 *  user_confirmed value becomes a "Needs you" suggestion, never a write. */
export function decideWrite<T>(cur: SourcedValue<T> | undefined,
  next: SourcedValue<T>): WriteDecision;

export function fromContextEvidence(e: { ref: string; version: string;
  source: string; trust: ContextTrust }): EvidenceRef; // sourceType "contextPack"
```

`src/shared/contracts/events.ts` (CT-1 types; AG-1 implements storage):

```ts
export const DOMAIN_EVENT_TYPES = [
  "project.created.v1",   // AG-1 emitter
  "business.confirmed.v1",// OD-2 emitter; payload { via: "discovery_card" }
  "market.confirmed.v1",  // MK-3 emitter
] as const;               // media.*, persona.*, website.published.v1 reserved in CT-2
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];
export type DomainEvent<P> = { type: DomainEventType; projectId: string;
  organizationId?: string; payload: P; emittedAt: number; correlationId: string };
```
Rule: `<entity>.<past_tense>.vN`, no `project.` prefix except for the
project entity itself; a type enters the union only with its emitter.
`website.published.v1` may be emitted only by server code holding a receipt.

`src/convex/agent/registry.ts` (AG-2):

```ts
export type CapabilityId = `${string}.${string}.v${number}`; // + runtime regex
export type CanRunResult = { ok: true }
  | { ok: false; state: "locked" | "needs_setup" | "unavailable" }; // lib/capabilities vocabulary
export type CapabilityResult<O> = { capabilityId: CapabilityId; schemaVersion: number;
  output: O; evidence: EvidenceRef[]; warnings: string[]; confidence?: number };
export interface Capability<I, O> {
  id: CapabilityId; version: number;
  canRun(ctx: ActionCtx, access: OrgAccess, projectId: Id<"projects">): Promise<CanRunResult>;
  execute(ctx: ActionCtx, access: OrgAccess, input: I): Promise<CapabilityResult<O>>;
}
```
`canRun` calls `resolveCapabilityState` from `lib/capabilities.ts` first.
Registered ids now: `bootstrapProject.v1` (the starter-kit job, wrapped, no
second workflow), `business.understand.v1`; later `business.resolve.v1`
(OD-1), `market.resolve.v1` (MK-1). `CanRunResult` reuses the shipped
`locked|needs_setup|unavailable` words instead of plan-agent's
`plan|role|setup|country` reasons.

Feature-local contracts (not shared; listed so names match):
- Media (MD-1, `src/shared/media.ts`): `MediaSource = "upload"|"owner_site"|
  "stock"|"camera"`; `Authenticity = "original"|"authentic_transform"|
  "generative_edit"`; `ProcessingStatus = "uploading"|"processing"|"ready"|
  "failed"`; `QualityFlag = "blurry"|"too_dark"|"too_bright"|"low_resolution"
  |"unreadable"` (HEIC or undecodable: never a fake score).
- Market (MK-1): `projects.marketContext?: SourcedValue<{ country: string /* ISO
  3166-1 alpha-2 */; currencyCode: string /* ISO 4217 */; primaryLocale:
  string /* BCP 47 */ }>`. Mapping: user edit = `user_confirmed`; confirmed
  `businessProfile.market` = `accepted_artifact`; scan `businessDetails.country`
  or page `lang` = `first_party`; Google listing = `provider`; TLD alone or AI
  draft = `inferred`; nothing = unset, UI shows `needs_setup`.
- Personas (MK-4): `bigFive` keeps its shape; new optional
  `bigFiveAuthority: "inferred" | "user_confirmed"` (missing = inferred).

---

## 4. Consolidated tickets

Size: S under 2 days, M 2-4 days. "Schema" = schema.ts change. "Gate" = owner
decision or U12 result required before start (or before enable).

| ID | Title | BP | Wave | Depends on | Size | Schema | Gate |
|---|---|---|---|---|---|---|---|
| W0 | Merge #19, #13 (+PF-1, PF-2), #22 | integ | 0 | - | S | no | D2 |
| FU-3 | Goal fields docs + businessProfile seed | integ | 1 | W0 | S | comments | - |
| FU-5 | Terminology copy pass | integ | 1 | W0 | S | no | - |
| CT-1 | Shared provenance + event contracts | all | 1 | - | S | no | - |
| CT-2 | ADR: registry, events, Workflow (D7) | all | 1 | - | S | no | D7 |
| SEC-1 | Wizard scan stored server-side | DISC | 1 | W0 | M | no | - |
| HM-1 | `home.priorities` query | integ | 2 | W0 (#19) | M | no | - |
| HM-2 | Home "For you now" redesign | integ | 2 | HM-1 | M | no | D8 |
| HM-3 | U4b start-kit entry + "Looks right" | integ | 2 | HM-2 | S | maybe | - |
| U12 | Usability sessions on HM-2 build | owner | 2 | HM-2 | - | - | owner |
| AG-1 | `domainEvents` + `capabilityRuns` + first emitter | AGENT | 3 | CT-1, CT-2 | M | yes | - |
| AG-2 | Agent registry + `bootstrapProject.v1` | AGENT | 3 | AG-1 | S | no | - |
| AG-3 | Gateway `modelClass` hint | AGENT | 3 | CT-2 | S | no | - |
| AG-4a | Wrap `business.understand.v1` | AGENT | 3 | AG-2 | M | no | - |
| KIT-1 | Starter-kit cancel path | AGENT | 3 | AG-2 | S | no | - |
| MD-0 | Picture picker: kit posts + Create | MEDIA | 4 | W0 (#13) | M | no | - |
| MD-1 | `projectFiles` media fields + `mediaVariants` | MEDIA | 4 | - | S | yes | - |
| MD-2a | Post-upload quality check | MEDIA | 4 | MD-1 | M | no | - |
| MD-2c | Crop presets + stored crop rectangles | MEDIA | 4 | MD-1, MD-0 | S | no | - |
| MD-0b | Sell product picker (`projectFileId`) | MEDIA | 4 | MD-0, MD-1 | S | no | - |
| MD-3 | Take a photo (file input capture) | MEDIA | 4 | MD-1, MD-2a | S | no | - |
| MD-S | Sharp in Convex node action spike | MEDIA | 4 | MD-1 | S | no | informs D4 |
| MK-1 | `marketContext` + `market.resolve.v1` | MARKET | 4-6 | CT-1 | M | yes | - |
| MK-2 | CLDR locale/currency into ContextPack | MARKET | 4-6 | MK-1 | S | no | D13 |
| MK-3 | Settings "Market" row + `market.confirm` | MARKET | 4-6 | MK-1, AG-1 | S | no | - |
| MK-4 | Persona Big Five labeled "AI guess" | MARKET | 4-6 | CT-1 | S | yes | - |
| OD-1 | `business.resolve.v1` + `discoveryCandidates` | DISC | 5 | CT-1, SEC-1, U12 | M | yes | U12, D12 |
| OD-2 | Confirm card in wizard + event | DISC | 5 | OD-1, AG-1, FU-5 | M | no | U12, D8-style copy |
| OD-4 | Resolver benchmark script (manual) | DISC | 5 | OD-1 | S | no | - |
| Deferred | AG-4b/c, AG autonomy, Phases D-G, MD-2b, MD-4 shot planner, MK-5 World Bank, OD-3 enrichment | | 7+ | | | | D3-D5, D11 |

### Per-ticket detail (compact; every ticket also updates `docs/pack/STATUS.md`)

**CT-1** Goal: one provenance and event vocabulary. Files:
`src/shared/contracts/provenance.ts`, `events.ts`; `lib/contextPack.ts`
re-exports `ContextTrust`. Acceptance: no second `SourcedValue`/`EvidenceRef`
anywhere (`rg`), `contextPack.ts` unchanged in behavior. Tests: `decideWrite`
table (locked never overwritten; lower never overwrites higher; first_party
vs user_confirmed returns `suggest`); `fromContextEvidence` mapping.

**CT-2** ADR `docs/decisions/2026-09-xx-agent-registry-and-events.md`:
`agent/registry.ts` naming (not `capabilities/`), event naming and reserved
names, `domainEvents` retention (cascade-with-project, 180-day sweep), D7
outcome (keep job tables). Also creates the missing
`docs/pack/08-module-contracts.md` stub pointing at CT-1. Docs only.

**SEC-1** Goal: the wizard stops sending scan findings to the server. The
background read calls a server action that stores the scan server-side
(pre-project: in a short-lived row keyed by user and URL; post-create: via
`storeServerScan`); `saveScan` loses its client callers and is removed after
one release. Files: `projects.ts`, `scraping.ts`, `NewProjectWizard.tsx`.
Tests: regression test that a client cannot set `websiteScan.images` to an
arbitrary URL and then `importOwnerPhoto` it (fails before the fix). OD-1
builds on this path. If owner prefers, the pre-project row is OD-1's
`discoveryCandidates` table and SEC-1 lands with OD-1 (see D12).

**HM-1/HM-2/HM-3** unchanged from INTEGRATION-PLAN 3.2 and Wave 2. HM-2 is
UI only (max 3 items, 320 px e2e, axe). AGENT Phase E components are HM-2.

**AG-1** Tables `domainEvents` (type, projectId, organizationId?, payload,
emittedAt, correlationId; indexes `by_project`, `by_type_time`) and
`capabilityRuns` (capabilityId, projectId, userId, organizationId?,
inputHash, status in the seven job states, evidenceCount, error?, times;
`by_project`, `by_project_capability_hash`). Both registered with
`project()` in `dataRegistry.ts`. `agent/events.ts` `emit()`; first emitter
`project.created.v1` in `projects.create`/`createClientProject`. Tests:
emit row shape; registry audit green; create emits exactly once; project
deletion removes both tables' rows.

**AG-2** `agent/registry.ts`, `contracts.ts`, `errors.ts`, `policy.ts`
(wraps CT-1 `decideWrite`). Registers `bootstrapProject.v1` as a pointer to
the existing starter-kit start/status functions, no logic change. Tests:
invalid id rejected; unknown id throws typed error; `canRun` returns
`locked` for a free plan where `lib/capabilities.ts` says so.

**AG-3** Optional `modelClass: "fast"|"standard"|"reasoning"` on
`ModelGatewayRequest`, used by `aiModels.resolveForRequest` only when
`model` is absent. No schema (not stored on `aiRuns` yet). Tests: class
picks configured model; callers without it unchanged (regression).

**AG-4a** Wrap the business-profile draft (`draftBusinessProfile` path) as
`business.understand.v1`: writes a `capabilityRuns` row, idempotent by
input hash, returns `evidence` via `fromContextEvidence`. No prompt change.
Tests: second run with same inputs returns cached run; existing profile
tests green. AG-4b (personas) and AG-4c (journeys) only after AG-4a ships
and shows value (review with owner at Wave 3 end).

**KIT-1** `starterKit.cancel` orgMutation (owner only) sets kit and running
parts to `canceled`; the running action checks status before each part and
stops. Tests: cancel mid-run leaves no further writes; canceled kit can be
restarted as a new kit.

**MD-0** `src/components/app/media/MediaPicker.tsx` (tabs "Your photos",
"From your website", "Stock photos"; reuses `files.list`, `stock.*`). New
server mutation takes `projectFileId`, checks same project, resolves URL and
attribution server-side (never a client URL). Wired into `PostsCard.tsx` and
the Create image block (#13). Tests: swap updates the draft; foreign
project file rejected; keyboard dialog, focus return; empty/loading/error.

**MD-1** Additive `projectFiles` fields: `kind`, `role`, `width`, `height`,
`checksum`, `authenticity`, `derivedFromFileId`, `processingStatus`,
`qualityScore`, `qualityFlags`, `source` gains `camera`. `mediaVariants`
(`projectId`, `projectFileId`, `preset`, `crop {x,y,w,h}`, `storageId?`,
`createdAt`; `by_project`, `by_file`). `productMedia.projectFileId?`.
Registry entries; deletion also removes variant blobs. No `mediaUsage`.
Tests: registry audit, codegen, deletion removes variants.

**MD-2a** `src/lib/media/qualityChecks.ts` (pure scoring on decoded pixels,
fixtures) + `src/convex/mediaLibrary/quality.ts` node action scheduled from
`files.attach`; decoder is pure JS (`jpeg-js`/`upng-js` class), unknown
formats get `unreadable`, never a guessed score. Upload never blocked.
Nudge copy: "This photo looks a little dark. Use it anyway, or try another?"
announced in a live region. Tests: dark/blurry/low-res fixtures; status
`processing -> ready|failed`; failure leaves file usable.

**MD-2c** `src/lib/media/presets.ts` (16:9, 4:3, 1:1, 4:5, 9:16, 1.91:1,
stable ids) + crop-rectangle math; picker stores rectangles in
`mediaVariants`, rendering uses `object-position`. Tests: preset id snapshot,
crop math.

**MD-0b** Sell product gallery opens `MediaPicker` scoped to role product;
writes `url` and `projectFileId` server-side. Extract the gallery from
`Sell.tsx` first (AGENTS section 8). Tests: existing URL-only rows still render.

**MD-3** "Take a photo" button: `<input type="file" accept="image/*"
capture="environment">` feeding the existing upload path with
`source: "camera"`; static per-role checklist. Tests: file reaches
`files.attach` with source camera; hidden where capture unsupported falls
back to upload. No new permission prompt of our own.

**MD-S** Spike branch, not merged: `node.externalPackages: ["sharp"]` in
`convex.json`, one action resizing a fixture; record cold start, bundle
size, failure mode. Output is a D4 note, not a feature.

**MK-1** `src/convex/market/resolve.ts` deterministic resolver (no LLM,
no network) using the mapping in section 3; additive
`projects.marketContext`; `personas.country`/`businessProfile.market` stay
read-only inputs. Tests: authority order; unresolved stays unset; client
cannot write it (no public setter here).

**MK-2** `src/convex/lib/cldr.ts` committed subset generated by a
`scripts/` step; `ContextPack.market?` with `reference_data` trust; AI
prompts get currency/locale; Sell currency is prefilled only when empty and
shown as a suggestion (D13). Tests: known country mapping; no USD/en-US
default when unresolved.

**MK-3** `ProjectSettings.tsx` "Market" row (country, currency, language,
`StatusBadge` "Confirmed" or "Estimated"); `market.confirm` orgMutation
validates ISO codes server-side, writes `user_confirmed`, emits
`market.confirmed.v1`. Tests: ownership, invalid code rejected, event once.

**MK-4** Persona editor label "AI guess, not a real customer" on Big Five
unless `bigFiveAuthority === "user_confirmed"`; editing a slider sets it.
Tests: label logic; edit promotes authority.

**OD-1** `src/convex/discovery/resolve.ts` (`business.resolve.v1`): email
domain or typed URL, free-mail list short-circuits to `no_match`, crawl via
existing `runWebsiteScan`, stored server-side in `discoveryCandidates`
(userId, domain, status `pending|resolved|no_match|failed`, name?,
website?, businessType?, scan snapshot, confidence, evidence, expiresAt;
`by_user_domain`), user-scoped registry entry with `accountCleanup` and an
expiry sweep. Confidence threshold returns `no_match` (old OD-5).
`projects.create` accepts `candidateId` and copies the scan server-side;
additive `projects.discoveryCandidateId?`. Tests: free-mail no crawl; TTL
reuse per user; no cross-account reuse; DNS failure is `failed`.

**OD-2** Optional step 0 in `NewProjectWizard.tsx`,
`wizard/ConfirmCard.tsx`. Title "Is this your business?", subline "We read
this from northstar.coffee on 25 Sep". Type shown as "Our guess". No
checkmarks, no "found", "verified" or "connected" words for inferred values;
nothing written to `projects` before "Yes, this is us". Emits
`business.confirmed.v1` on project creation from the card. Tests: three
answers route correctly; 2-screen cap e2e; axe; focus on heading.

**OD-4** `scripts/benchmark-business-resolve.mjs`, manual only (never in
CI), owner-supplied public fixture domains; match rate, wrong-company rate,
p50/p95. Feeds D3.

---

## 5. Dependency graph, lanes, critical path

```
W0 (#19,#13+PF,#22) --> FU-3, FU-5, SEC-1
W0 --> HM-1 --> HM-2 --> HM-3
                  \--> U12 ==(friction?)==> OD-1 --> OD-2
CT-1 --> AG-1 --> AG-2 --> AG-4a, KIT-1          SEC-1 --> OD-1
CT-2 --> AG-1, AG-3                               AG-1 --> OD-2, MK-3
MD-1 --> MD-2a --> MD-3 ; MD-1 --> MD-2c, MD-0b, MD-S
W0(#13) --> MD-0 --> MD-2c, MD-0b
CT-1 --> MK-1 --> MK-2, MK-3 ; CT-1 --> MK-4 ; OD-1 --> OD-4
```

Parallel lanes after Wave 1 (each lane one engineer or agent, PRs serial
inside a lane):
- Lane H (Home): HM-1, HM-2, HM-3, then U12 support.
- Lane A (agent): AG-1, AG-2, AG-3, AG-4a, KIT-1.
- Lane M (media): MD-1, MD-0, MD-2a, MD-2c, MD-0b, MD-3 (MD-1 and MD-0 can
  run in parallel; MD-0 has no schema dependency).
- Lane K (market): MK-1, MK-4, MK-2, MK-3 (starts after CT-1; may start in
  Wave 4 rather than Wave 6 because it needs no provider and no U12 result).
- Lane D (discovery): idle until U12 reports; SEC-1 is its only early work.

Conflict hot spots: `schema.ts` (AG-1, MD-1, MK-1, MK-4, OD-1: land schema
PRs one at a time and rebase), `NewProjectWizard.tsx` (SEC-1 before OD-2),
`ProjectSettings.tsx` (MK-3 only), `Overview.tsx` (HM-2 only; no other lane
touches Home until HM-2 merges).

Critical path to the product decision: W0 -> HM-1 -> HM-2 -> U12 -> OD-1 ->
OD-2 (about 4 to 5 weeks). Everything in lanes A, M and K is off it.

U12 gates: OD-1 start and OD-2 ship (hard); whether AG Phase E becomes more
than HM-2's list (soft, with D8); FU-5 wording may change from U12 findings;
MD-0 and MK are not gated (kit pictures and currency are known needs).

---

## 6. Owner decisions (D1-D10 from INTEGRATION-PLAN kept; new D11-D14)

| # | Question | Recommendation | Blocks |
|---|---|---|---|
| D1 | Per-kit AI budget $0.40 | Confirm for launch | - |
| D2 | Merge the train before U12 | Merge now | W0 |
| D3 | Build discovery; which provider | Resolver on own site only; provider only after OD-4 data | OD-3 |
| D4 | Media processing provider | No provider for MD-0..3; decide after MD-S; lean Cloudinary EU if a paid reason appears | MD-2b |
| D5 | GDPR Art. 14 notice for enrichment | Legal review before any live OD-3 call | OD-3 enable |
| D6 | Big Five priors and WVS | Cut (unchanged) | - |
| D7 | Convex Workflow component | Keep job tables; record in CT-2 | CT-2 |
| D8 | Home IA: one ranked list, max 3 | Approve | HM-2 |
| D9 | Agency hand-off payer | Owner call | U9 slice 2 |
| D10 | Is `main` auto-deployed | Answer before first `primaryGoal` production write | - |
| D11 (new) | Enrichment credit cap separate from D1 | $0 (flag off) until D3 is yes, then a per-org monthly cap | OD-3 |
| D12 (new) | May MOSAI read the website at a signup email's domain without asking? (employee of another company case) | Only after sign-in, shown as "Looking up northstar.coffee" with Skip, and "Different business" one tap away | OD-1 |
| D13 (new) | Money-adjacent: may MOSAI prefill Sell currency from the resolved market | Prefill only empty fields, labeled "Suggested", never change an existing currency | MK-2 |
| D14 (new) | Scope of the agent spine after AG-4a | Review at Wave 3 end; build AG-4b/c only if a Home or Create feature consumes capability runs | AG-4b/c |

Dropped from specialist plans: plan-media's camera privacy decision (moot
with file-input capture), MKD-1/MKD-2/MKD-3 (technical, decided here: defer
World Bank, generate CLDR subset from a package into a committed file,
attribution in an about page), MKD-4 (decided: separate MK-4).

---

## 7. Corrections to the specialist plans

1. CT-1 had no owner: now a Wave 1 ticket holding provenance and event types;
   AG-2 no longer creates `provenance.ts`. CT-2 absorbs plan-agent's AG-0.
2. `ContextTrust` gains `reference_data` in CT-1 (plan-market had invented a
   local `static_reference`); `ContextTrust` moves to shared and is
   re-exported, so contextPack stays the consumer, not a second source.
3. `canOverwrite` (boolean) became `decideWrite` (write/skip/suggest) so the
   integration plan's "Needs you instead of overwrite" rule is implementable.
4. `CanRunResult` reasons use shipped `locked|needs_setup|unavailable`.
5. AG-3 no longer widens `AiAutonomy`/`aiRuns.autonomy`: `act_external`
   without an approval gate invites fake success; widen when a capability
   needs it, in its own schema PR.
6. AG-1 ships a real emitter (`project.created.v1`), answering plan-agent's
   open "events with no callers" question.
7. "Add missing `canceled` state" corrected to KIT-1 cancel path; the state
   already exists (`src/shared/starterKit.ts:58`).
8. Discovery renamed to `discovery/` and `business.resolve.v1`
   (INTEGRATION-PLAN's `organization.resolve.v1` collides with the glossary);
   table `discoveryCandidates` keyed per user, not a shared domain cache.
9. OD-2's `projects` field moved into OD-1 (no schema in a UI PR); OD-5
   merged into OD-1; OD-6 dropped; OD-4 is manual, never in CI.
10. New SEC-1: the wizard's client-written scan (`saveScan`) is replaced by a
    server-stored scan, a prerequisite for trusting OD-1 and for
    `importOwnerPhoto`'s validation.
11. MD-2a quality fields folded into MD-1 (one schema PR); `mediaUsage` cut
    until a writer exists; `mediaVariants` carries `projectId` + `by_project`
    so registry cascade works; `storageId` optional because v1 stores crop
    rectangles only.
12. MD-3 returns to file-input capture (INTEGRATION-PLAN wording);
    `getUserMedia` and the shot-planner capability (MD-4) are deferred.
13. Sharp claim softened: Convex supports native `externalPackages`, but it
    is unproven here, so MD-S spike informs D4 instead of a blanket "no".
14. MK-1 drops its dependency on OD ("confirmed address" never produced);
    uses scan `businessDetails.country`, listing, confirmed profile. MK lane
    may start after CT-1. Market line removed from the OD confirm card.
15. MK-3 (World Bank) renumbered MK-5 and deferred; MK-3 is now the Settings
    market row, which plan-market described but never ticketed.
16. MD-0 writes pictures by `projectFileId` resolved server-side, never a
    client URL, so posts keep AGENTS rule 3 intact.

## 8. Coordinator verification note (SEC-1 severity)

Checked against `src/convex/projects.ts:370-400` on main `ac85a8d`. `saveScan` is an
`orgMutation` that calls `access.requireProject(id)`, so only a member of the project can
write it, and its validator deliberately excludes `images`; only the server-side
`storeServerScan` may record image addresses, so a browser cannot choose what
`importOwnerPhoto` downloads. The residual issue is narrower than stated above: the scan
text (name, description, services, listing data) is written by the owner's browser and
later read by AI calls as if it were first-party website evidence. Treat SEC-1 as a
data-integrity / provenance fix (label client-written scan fields as `user_supplied`, or
move the first-run scan server side), priority Wave 1 but not a security blocker.
