# Business-Engineering Review: Four New Blueprints vs. Shipped Starter Kit

## 1. Overlap / conflict with shipped starter kit (U2/U4/U5, PRs #14/#16/#18/#20)

- **ORGANISATION-DISCOVERY-ONBOARDING is a direct, larger replacement for U2's
  three-question wizard**, not an addition. Shipped: 3 questions -> kit. Blueprint:
  work-email -> domain resolve -> enrichment provider + website crawl -> confirm
  screen -> "ask only what we can't find." This is a strict superset in ambition
  but touches the *same* screen/flow U2 just shipped and U12 hasn't even user-tested
  yet. Redundant if shipped early; extends it (removes remaining manual fields) if
  sequenced after U12 shows the 3-question wizard still has friction.
- **No overlap with U5 (Pexels)**: none of the four blueprints touch stock photos.
  CAMERA-COACH is additive: it targets the owner's *own* photos (shot planning,
  live capture coaching, authentic enhancement), which is explicitly the fallback
  path U5's blueprint already prefers ("owner photos first, then Pexels"). Camera
  Coach makes that first path strong instead of a thin fallback.
- **FUTUREPROOF-AGENT is infrastructure underneath everything shipped**, not a
  competing feature. The kit's background jobs (plan, draft, posts) are currently
  ad hoc; this blueprint's capability registry/events/orchestrator would become the
  spine those jobs run on. It doesn't duplicate the kit, it formalizes it.
- **COUNTRY-CULTURE-PSYCHOGRAPHIC has no shipped counterpart**: it's a new
  capability (market/persona context) that only becomes useful once personas and
  the persona-authored content in the kit exist, which they do.

## 2. Recommended sequencing (after PRs merged, before U12 findings)

1. **FUTUREPROOF-AGENT (capability registry + events, Phases A-C only)**: every
   other blueprint's "Integration with Future-Proof Agent Blueprint" section
   assumes `organization.resolve.v1`, `business.confirmed.v1` style capabilities
   and events already exist. Building org-discovery or country-context first means
   re-plumbing later. Ship the registry/event contract skeleton, not the full
   orchestrator/workflow engine (defer Phases D-G).
2. **Run U12 (5-owner usability test) on the already-shipped starter kit before
   touching onboarding further.** Do not build ORGANISATION-DISCOVERY on
   assumption; the strategy doc itself flags this as the open question.
3. **ORGANISATION-DISCOVERY-ONBOARDING, MVP scope only** (§31: domain extraction,
   one provider, website crawl, confirmation, one goal question): informed by
   U12. Defer person enrichment, ambiguous-match resolution, multi-business (all
   explicitly out of MVP in the blueprint itself).
4. **CAMERA-COACH, Authentic mode only** (shot planner + live quality metrics +
   Cloudinary transforms). Defer Video Coach, Creative AI generative path, Canva/
   Photoshop integrations: all explicitly optional/later in the blueprint.
5. **COUNTRY-CULTURE-PSYCHOGRAPHIC, last and narrowest.** Ship only the
   non-personality tiers (World Bank/CLDR/UNDP demographic+digital context for
   market resolution and locale/delivery decisions: blueprint §33-38). Defer the
   entire Big Five population-prior system (§15-27, §46-51): see §4 below.

Rationale: registry first (shared dependency), then validate the existing
onboarding before replacing it, then the two owner-facing feature blueprints in
order of straightforward win-to-risk ratio (camera coach is bounded, well-scoped,
low legal risk vs. culture/personality which carries real reputational risk),
psychographics last since it's the most speculative and highest legal exposure.

## 3. Owner decisions needed before build (AGENTS.md §7)

- **Enrichment provider (Apollo vs CompanyEnrich):** blueprint explicitly defers
  this to a 50-100 business bake-off (§7.3): correctly flagged as not an
  architecture decision. Needs owner sign-off on budget for the bake-off itself
  and the recurring per-lookup cost.
- **Cloudinary:** new paid external provider/vendor lock-in decision, not yet in
  the stack. Needs owner approval (cost tier, data residency for uploaded photos).
- **Pexels licensing/attribution:** already owner-decided per STATUS/usability
  docs (V4 terms, attribution link, PEXELS_API_KEY): not a new decision, just
  confirm the shared 200/hr quota (flagged capacity risk F11) still holds once
  Camera Coach adds more image volume.
- **WVS license:** blueprint itself says "restricted_for_default_commercial_use"
  and blocks it unless permission is obtained (§29, §55): must not ship enabled
  by default; owner must decide whether to pursue a license or drop WVS entirely.
- **GDPR Art. 14 notice:** org-discovery blueprint is explicit this needs legal
  review before launch (§22.2): flag to owner/legal before any enrichment call
  goes live, not just before "production."
- **Big Five population priors:** highest-risk item, see §4. Owner should decide
  whether to build this at all for MVP, independent of the license question.

## 4. Weak / overbuilt claims (critical)

- **Big Five population priors (country-culture §15-27, §46-51) are overbuilt and
  high-risk for a small-business MVP.** The blueprint's own guardrails (§28
  "prevent stereotype feedback loops", §39 "demographic guardrails", §44 "do not
  show personality country scores by default") are essentially a list of reasons
  this feature is dangerous to ship: country-level Big Five means "people in
  Netherlands are more X" gets baked into content generation for a marketing tool
  built for small businesses who will not audit provenance chains. The stated use
  ("hypothesis generator" for A/B copy tests) doesn't need population personality
  science: a simpler tone/style experiment framework achieves the same business
  outcome without the stereotyping/PR risk or the ETL/licensing overhead (§46-48,
  survey weighting, freshness classes). Recommend cutting this sub-feature from
  MVP scope entirely and shipping only the demographic/economic/digital context
  layers, which have clear, low-risk uses (locale, currency, uptime expectations).
- **ORGANISATION-DISCOVERY's full pipeline (enrichment + crawl + reconciliation +
  confidence scoring + provenance model) is a lot of new infra to replace a
  3-question wizard that hasn't been user-tested yet.** Before committing to
  the bake-off and a new paid provider, U12 results may show the 3-question
  wizard is already fine: build order in §2 above avoids this risk, but the
  blueprint as written doesn't gate itself on that check.
- **CAMERA-COACH's browser-based live quality metrics (blur/exposure/horizon/
  motion/subject-size/crop-safety, §13) is a lot of real-time computer-vision
  surface for a v1.** Reasonable long-term, but MVP could ship shot-planning +
  post-capture quality feedback (server-side, after upload) instead of live
  in-browser coaching, cutting significant complexity and device-compatibility
  risk (§11 permissions, §33 offline/poor network) without losing most of the
  owner value (a well-composed photo).
