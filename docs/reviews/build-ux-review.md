# Build module — UX and product review against AI app builders

**Date:** 24 Sep 2026 · **Baseline:** `b62c29f` (main) · **Type:** read-only review; no source files were changed.
**Scope:** `src/pages/app/Build.tsx`, `src/components/build/*`, `src/components/cms/*`, the Build back end (`src/convex/build*.ts`, `cms.ts`), its links to `AppShell.tsx`, `Overview.tsx` and `Landing.tsx`, and the business model (`billing.ts`, `billingPlans.ts`, `entitlements.ts`, `lib/capabilities.ts`, `guards.ts` AI quota).

> **Missing input.** `docs/pack/05-design-system.md` is not in the repository. `docs/pack/STATUS.md` lists it as absent (the table near the end of that file). Design-system judgements below rely on `AGENTS.md` §5 rule 15, `src/index.css` token names and the existing components.

---

## 0. Summary

MOSAI Build does have the Lovable-style layout: an idea screen, then chat on the left and a preview on the right. It also has versions and a publish button that tells the truth about what it does. Behind that layout, it loses to every competitor on the parts users feel in their first five minutes:

1. **Chat edits the wrong page.** The chat never sends the page you are looking at, so every Build-mode edit goes to the homepage (`BuildWorkspace.tsx:187`, `buildChat.ts:434-448`). This is the largest single defect.
2. **The differentiator is computed and then thrown away.** The strategy blueprint (positioning, goals, differentiators, pages tied to personas and journey stages) is produced at `Build.tsx:170-196`. The site generator never reads it: `generateSite` uses only `build.idea` plus a generic context pack (`buildChat.ts:277-279`, `67-89`). Plan-mode suggestions are also discarded (`buildChat.ts:201-221` stores them, and nothing consumes them).
3. **Nothing reaches the public web.** "Publish" only prepares a release (`buildWorkspace.ts:283-453`), `/shop/*` requires sign-in (`main.tsx:211-217`), and custom domains are "W3" (`SitePanel.tsx:712-713`). Every competitor ships to a public URL in one click on its free tier (Caffeine's free tier is limited; see §2).
4. **Generated sites all look like the MOSAI dashboard.** `PageRenderer` uses the app's own tokens (`font-mono`, `text-terminal-green`, `shadow-card`). There is no brand theme, header, nav or footer. CTAs render as `<span>`, not links (`PageRenderer.tsx:46-50`, `111-113`). Image blocks always show "no image selected", because the generator cannot pick an asset (`buildChat.ts:230`, `PageRenderer.tsx:72-91`).
5. **No usage metering or free tier for Build.** Build is locked on `free` (`capabilities.ts:200-212`). Locked users are silently redirected to `/app/billing` (`App.tsx:104-107`). The only AI limit is a flat 30 requests per 10 minutes for all plans (`guards.ts:1619-1620`). Per-run cost is recorded in `aiRuns` (`modelGateway.ts:78-87`) but never shown to the customer. There is no upgrade moment inside Build.
6. **Several broken or misleading details.** Deleting a build does nothing (`Build.tsx:776-786`, `844`). A build lives only in React state, so refresh or back loses it (`Build.tsx:676`). Two website builds in one project share one site (`buildInternals.ts:179-182`). The versions menu labels a prepared snapshot "· live" (`BuildWorkspace.tsx:413-416`). `PageEditor` toasts "This version is now live" (`PageEditor.tsx:239-240`), although nothing is served publicly.

**Top recommendations** (details in §4):

- **P0:**
  - Target the active page in chat.
  - Feed the blueprint and personas into generation.
  - Make the build URL-addressable.
  - Fix delete.
  - Remove the "live" wording.
  - Stream generation progress.
  - Make the renderer produce a real-looking site: theme, header, footer, real links.
- **P1:**
  - Click-to-select visual editing on top of the existing block model.
  - Resizable split and device preview.
  - A hosting path to a public subdomain, following the proposed hosting decision.
  - A visible usage meter with upgrade moments. Pricing itself is an owner question.
- **P2:**
  - Templates and remix built from business context.
  - Forms feeding Customers.
  - Live commerce blocks.
  - GitHub/export.
  - App generation (depends on the sandbox ADR).

---

## 1. Current MOSAI Build user flow, step by step

### 1.1 Getting to Build

| # | Step | Code | Friction |
|---|---|---|---|
| 1 | Landing page: a "Create your workspace" CTA leads to email-code auth. It has no prompt box. | `Landing.tsx:599-619` | Every competitor's homepage *is* a prompt box. MOSAI asks for sign-in and project setup before the visitor sees any output. The landing text also says "Free plan includes Understand, Journeys and Create" (`Landing.tsx:620-623`), so Build is not in the first-run path at all. |
| 2 | The sidebar lists Build with the description "Plan and create websites and apps". On `free` it shows a lock badge and links to `/app/billing`. | `AppShell.tsx:69`, `219-252` | The first contact with Build is a paywall with no preview of what Build does. |
| 3 | A deep link to `/app/:id/build` while locked is `<Navigate to="/app/billing" replace>`. | `App.tsx:104-107` | A silent redirect gives no reason and has no "try it" path. `replace` also removes the history entry. |
| 4 | Overview's module card claims "Websites & apps from personas, with SEO/WCAG checks". | `Overview.tsx:79-83` | No SEO/WCAG check appears anywhere in the Build workspace. `builds.getReadiness` and `buildWorkspace.getSiteDelivery` exist, but no UI component calls them (grep: 0 uses in `src/**/*.tsx`). The build list shows `seo: — · wcag: —` (`Build.tsx:833-836`). This is an overclaim. |

### 1.2 Creating a website build

| # | Step | Code | Friction |
|---|---|---|---|
| 5 | Build list, then **New build** opens a dialog with a name, a type `<select>` (website/app) and an idea textarea. | `Build.tsx:751-774`, `219-297` | Three fields and a modal before any output. The type select renders raw lowercase values (`website`, `app`). The name field is required, although it could be derived from the idea. |
| 6 | **Plan build** calls `builds.create`, then the AI action `buildPlan.generateBuildPlan`, then `builds.update`, then one `buildPages.create` per page, one after another. | `Build.tsx:133-216` | This blocks the modal for a full LLM call with only a spinner (`289-293`). There is no progress, no cancel and no streaming. If planning fails, the build is created but empty, with a warning toast (`201-208`). |
| 7 | The dialog closes and the user is back at the list. They must click the row. | `Build.tsx:209`, `808-826` | There is an extra click after the "Plan build" success toast, and the toast points to "the Plan tab", which is inside **Manage**, not the view the user opens next. |
| 8 | Opening the row lands on `BuildWorkspace`. No site exists yet, so `BuildIdeaScreen` shows, pre-filled with the idea from step 5. | `Build.tsx:736-748`, `BuildWorkspace.tsx:506-514`, `75-151` | The user is asked the same question twice ("The idea" in the dialog, then "What should this website be?"). The screen promises "Plan mode first? Say so in chat" (`:145-147`), but no chat exists on this screen, and plan chat is only reachable after a site exists (`:516-528`). |
| 9 | **Build it** calls `buildChat.generateSite`: one LLM call with up to 6,000 output tokens (`buildChat.ts:260-281`), then writes pages, drafts, a version snapshot and a message. | `buildChat.ts:239-396` | This is a single blocking action with only "Building…" feedback (`BuildWorkspace.tsx:141`). It is not a job, contrary to `AGENTS.md` §5 rule 13. It **does not use the blueprint from step 6**: positioning, differentiators and persona- or stage-linked page plans are ignored (`:277-279` passes only `build.idea` and the message). |

### 1.3 Iterating in the workspace

| # | Step | Code | Friction |
|---|---|---|---|
| 10 | The layout is a fixed 380 px chat column and a preview column. The container height is `calc(100vh-220px)`. | `BuildWorkspace.tsx:517-528` | The split cannot be resized, although `src/components/ui/resizable.tsx` and `react-resizable-panels@^3` are already installed and unused. There is no mobile layout: on a phone the 380 px column crowds out the preview. The arbitrary px classes break rule 15. |
| 11 | Mode switch: Plan or Build. | `:202-223` | Plan suggestions render as inert cards (`cursor-default`, `:252-269`). There is no "Build these pages" or "Add page" action, and the server never feeds them into generation. |
| 12 | Send a Build-mode message, which calls `editPage({buildId, message})`. | `:184-189` | **The `pageId` is never sent.** The server falls back to the homepage (`buildChat.ts:434-448`). A user looking at `/pricing` who types "add a FAQ" gets the FAQ on the homepage. The regenerated blocks also get **new random ids every edit** (`:496-501`), so a block cannot keep a stable identity across edits. That rules out selection-based editing and diffing. |
| 13 | Page tabs switch the preview. | `:599-626` | Tabs are not linked to the chat target (see 12). There is no "add page" or "delete page" here. Page management is in Manage → Site. |
| 14 | The preview renders `PageRenderer` inside `max-w-4xl`. | `:629-645` | It has no device toggle (desktop, tablet, mobile), no open-in-new-tab and no header, nav or footer. Styling is the dashboard's own terminal theme, so every customer site looks the same (see §0.4). |
| 15 | The versions menu is a hand-rolled popover listing `vN`, a label and a time. Clicking a row restores it immediately. | `:336-433` | Restore has no preview or confirm, so one click overwrites current drafts. `restoreVersion` also **mutates the current draft revision in place** (`buildWorkspace.ts:233-237`). The hand-rolled popover lacks roving focus; `ui/dropdown-menu.tsx` exists. The "· live" label on `isPublished` is not true (see 17). |
| 16 | **Publish** calls `buildWorkspace.publishSite`. | `:471-492`, `:587-594` | The wording is honest ("Release prepared — not live yet"), which is correct under rule 5. Product-wise, though, the primary button in the toolbar is labelled **Publish** and does not publish, so the button promises more than it delivers. Preparation is all-or-nothing: one empty page blocks everything (`buildWorkspace.ts:344-350`), and the error arrives as a long toast string instead of per-page fix links. |
| 17 | After a prepared release, the newest version is flagged `isPublished`, and the menu shows "· live". | `buildWorkspace.ts:440-448`, `BuildWorkspace.tsx:413-416` | **Truth defect:** the UI says "live" while `getSiteDelivery` says `release_prepared` / not live. The same applies in `PageEditor.tsx:239-240` ("This version is now live"). |

### 1.4 Manage, and the second page model

| # | Step | Code | Friction |
|---|---|---|---|
| 18 | **Manage** opens Plan / Pages / Site tabs. | `Build.tsx:682-720` | These are two page models side by side. **Pages** lists `buildPages` rows whose "Draft" button produces **HTML** (`buildPlan.ts:233-278`), stored in `buildPages.draft` and shown in a modal (`Build.tsx:655-665`). Those drafts never reach the CMS pages that the workspace previews and publishes. Users will generate content that goes nowhere. |
| 19 | Site tab: the full CMS (pages, navigation, assets, redirects, settings). | `SitePanel.tsx:41-86` | Assets are added by pasting an **external URL** only (`:457-515`). There is no upload, and `files.ts` / `projectFiles` storage is not wired to it. Custom domains are "W3" (`:712-713`). "Open storefront" goes to `/shop/:projectId`, which is behind `RequireAuth` (`main.tsx:211-217`), so the user cannot share it. |
| 20 | Page editor: form-based block editor with up/down arrows, a preview toggle, History and Publish checks. | `PageEditor.tsx:185-435`, `545-640` | It is solid but form-first. Nothing can be clicked on the canvas, and blocks are reordered only with arrows (no drag). The publish-checks dialog is good and has no counterpart in the chat workspace. |

### 1.5 Build list housekeeping

| # | Step | Code | Friction |
|---|---|---|---|
| 21 | The trash icon sets `pendingDelete`. | `Build.tsx:839-847` | **Broken.** `ConfirmDelete` keeps its own `open` state and opens only from its trigger (`module-kit.tsx:151-170`). Here the trigger is a hidden `<span>` (`Build.tsx:783-785`), so the dialog never opens and the build cannot be deleted. Once this is fixed, `builds.remove` will orphan `buildMessages`, `buildVersions` and `buildReleaseAudits`, because it deletes only `buildPages` (`builds.ts:499-511`). |
| 22 | The selected build is local state. | `Build.tsx:676-680` | It has no URL: refresh, browser back and sharing a link all lose the workspace. Competitors put the project id in the URL. |
| 23 | A second website build in the same project | `buildInternals.ts:179-182`, `buildWorkspace.ts:28-37` | One `sites` row exists per project, so every website build previews and edits **the same pages**. The second build skips the idea screen and opens someone else's site in Plan mode. Either enforce one website build per project in the UI or give builds their own site. |
| 24 | App builds | `AppWorkspace.tsx:54-236` | A four-step brief wizard with honest copy ("App generation and live preview aren't available yet", `:162`). It is well structured, but it has no AI help: it could prefill from personas and journeys. The dialog, list and brief all repeat that nothing runs. For a competitor comparison this is a requirements form, not an app builder. |

### 1.6 Smaller correctness notes found on the way

- In `publishSite`, the approved revision reuses the latest revision's `version` number instead of `+1` (`buildWorkspace.ts:360-367`). This produces duplicate version numbers in page history.
- `siteContext` sends product **prices** to the model (`buildChat.ts:79-81`). This invites the model to copy commerce facts into copy, which is the rule `WEBSITE-VISION.md` calls "the single most important rule". Pass product names and ids only, and let `productGrid` resolve prices.
- `generateBuildPlan` and `generatePageDraft` are plain `action`s marked `service` owners (`capabilities.ts:540`). They are fine for auth, but they bypass the `build` capability gate that the chat actions use.
- The badge colour `text-amber-600 dark:text-amber-400` (`BuildWorkspace.tsx:548`) is a raw palette colour, not a token. Use `StatusBadge` or `ReceiptBadge` per rule 15.

---

## 2. Competitor UX today (verified as far as possible, 24 Sep 2026)

**How this was verified.** Direct fetches of `lovable.dev`, `docs.lovable.dev`, `bolt.new`, `v0.app`, `vercel.com` and `help.caffeine.ai` were **blocked by this environment's egress proxy**, so I could not read the primary pages myself. Every competitor fact below comes from web-search result summaries, with the source URL shown. Rows marked **(official)** cite the vendor's own domain as it appeared in search results. **(3rd-party)** means a review or blog. None were checked against a live product. Treat prices as indicative and re-check them before quoting them to anyone.

### 2.1 Lovable
- **Prompt-first landing, split chat and preview:** these are the core pattern of the product (widely documented; for example [nocode.mba tutorial](https://www.nocode.mba/articles/how-to-use-lovable) (3rd-party)).
- **Modes:**
  - Plan mode never modifies code and costs 1 credit per message plus any research sub-agents it runs ([lovable.dev/faq/ai-agent/plan-mode](https://lovable.dev/faq/ai-agent/plan-mode) (official)).
  - Agent/Build mode is usage-priced: roughly 0.5 credits for small tweaks and 1.5+ for larger requests ([lovable.dev/blog/agent-mode-beta](https://lovable.dev/blog/agent-mode-beta) (official); [docs.lovable.dev credits](https://docs.lovable.dev/introduction/credits-and-usage) (official)).
- **Visual Edits:** click an element and change its text, colour or layout. Visual changes reportedly **do not consume credits**, and early 2026 extended this to database-bound content ([docs.lovable.dev/changelog](https://docs.lovable.dev/changelog) (official, via summary)).
- **Version history and restore:** supported ([nocode.mba](https://www.nocode.mba/articles/how-to-use-lovable) (3rd-party)).
- **GitHub:** two-way sync, and Bitbucket Cloud as well ([docs.lovable.dev/changelog](https://docs.lovable.dev/changelog)).
- **Backend:** Supabase (Postgres, auth, storage, realtime) or a built-in "Lovable Cloud" backend ([docs.lovable.dev/features/projects/remix](https://docs.lovable.dev/features/projects/remix) (official)).
- **Publishing:** Share → Publish to `*.lovable.app`, with custom domains under Project → Settings → Domains ([lovable.dev/guides/how-to-publish-a-web-app](https://lovable.dev/guides/how-to-publish-a-web-app) (official)).
- **Templates and remix:** templates can be remixed (with a security acknowledgement). Projects are not remixable by default ([lovable.dev/faq/team/sharing/remix-copy-project](https://lovable.dev/faq/team/sharing/remix-copy-project) (official)). A featured gallery exists.
- **Pricing:**
  - Free: 5 credits per day, 30 per month cap.
  - Pro: $25 per month for 100 monthly credits, with rollover, top-ups, custom domains and badge removal.
  - Credits also meter Cloud hosting and in-app AI.
  - Sources: [softr.io](https://www.softr.io/blog/lovable-pricing), [nocode.mba](https://www.nocode.mba/articles/lovable-pricing) (3rd-party).

### 2.2 Bolt.new
- **Workspace:** prompt-first, with chat, code and preview (a StackBlitz WebContainer). "Discussion mode" chats without generating code ([support.bolt.new/llms.txt](https://support.bolt.new/llms.txt) (official, via summary)).
- **Version history:** every AI edit creates a checkpoint. Versions can be renamed and bookmarked ([support.bolt.new rollback-backup](https://support.bolt.new/building/using-bolt/rollback-backup) (official)).
- **Bolt Cloud:** a built-in database, auth, storage and edge functions, with an option to claim a Supabase database ([support.bolt.new/cloud/hosting](https://support.bolt.new/cloud/hosting) (official)).
- **Publishing:** everyone can publish to `*.bolt.host`. Custom domains are Pro-only ([shipper.now](https://shipper.now/bolt-custom-domain/) (3rd-party)).
- **Pricing:** token-metered. Free gives 300K tokens per day and 1M per month, with no rollover. Pro is $25 per month for 10M tokens and removes the daily cap ([banani.co](https://www.banani.co/blog/bolt-new-pricing), [support.bolt.new tokens](https://support.bolt.new/account-and-subscription/tokens) (official)).
- **Not verified:** a select-element / visual-edit feature and GitHub sync details. Search did not return an authoritative source.

### 2.3 v0 (Vercel)
- **Workspace:** prompt-first, with chat and a preview/code view. **Design Mode** is a visual editor for point-and-click tweaks.
- **Integrations:** GitHub sync (push, branches, PRs, merge-then-deploy), database connections and one-click deploy to Vercel.
- **Templates:** a template and community gallery.
- Source: [nxcode.io guide](https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026), [v0.app/docs/faqs](https://v0.app/docs/faqs) (official, via summary).
- **Pricing:**
  - Free: $5 of monthly credits and 7 messages per day, with watermarked deployments.
  - Team: $30 per user per month. Business: $100 per user per month. Both include $30 of credits plus $2 of daily login credits.
  - Credits are token-priced per model, roll over and expire after 65 days.
  - Sources: [nocode.mba](https://www.nocode.mba/articles/v0-pricing), [vercel.com/blog/updated-v0-pricing](https://vercel.com/blog/updated-v0-pricing) (official, via summary). The date and details of the older Premium $20 plan's sunset were not verified.

### 2.4 Caffeine (DFINITY)
- **Workspace:** a chat builder that deploys to the Internet Computer. It has **Draft vs Live** stages: each instruction produces a new draft, and you push a draft to live.
- **Rollback:** revert to version N from the chat history or the version panel. You cannot revert to a version older than the current live one, which protects live data.
- **Other features:** custom domains (bring your own, or buy through Caffeine on Studio), and an **App Market** with 250+ apps that can be remixed on every plan, including Free.
- Source: [help.caffeine.ai Plans and Pricing](https://help.caffeine.ai/hc/en-us/articles/46899796807060-Plans-and-Pricing) (official, via summary), [windowsforum summary](https://windowsforum.com/threads/caffeine-ai-build-apps-via-chat-with-spec-code-draft-and-live-stages.409340/) (3rd-party).
- **Pricing:**
  - Free: 10 welcome credits valid for 30 days, 3 projects, 3 drafts per project.
  - Host: $5 per month for 20 credits, with your own domain, email sending and analytics.
  - Studio: 100 credits per month, domain purchase and App Market publishing.
  - Source: same help article and [hostadvice review](https://hostadvice.com/ai-app-builders/caffeine-ai-review/) (3rd-party).

### 2.5 Freebuff
- Freebuff Web is marketed as a "100% free" full-stack app builder with auth, database and hosting included and "no credit meter". It is ad-supported (text ads during sessions), is the free edition of the open-source Codebuff, and also ships CLI, desktop and cloud agents ([freebuff.com/web](https://freebuff.com/web) (official, via summary); [bitdoze review](https://www.bitdoze.com/freebuff-free-ai-coding-agent/) (3rd-party)).
- **Not verified:** Freebuff Web's specific UX (visual edit, versioning, domains).
- **Relevance:** MOSAI's own preview deployment runs on a `freebuff.dev` host (`docs/implementation/ux-audit-2026-09-24/README.md`). Freebuff therefore sets the "free" price anchor for MOSAI's likely early users.

---

## 3. Gap table

Legend:
- ✅ = present
- ◐ = partial
- ✗ = absent
- ? = not verified

In the "Match?" column, **Yes** means table stakes, **Diff** means do it differently using business context, and **No** means deliberately skip.

| Capability | Lovable | Bolt | v0 | Caffeine | MOSAI today | Match? |
|---|---|---|---|---|---|---|
| Prompt box on the public landing page | ✅ | ✅ | ✅ | ✅ | ✗ (auth first, `Landing.tsx:599-619`) | **Diff:** offer a prompt that starts a project *and* runs the business scan, so the first result is a grounded site. |
| Prompt to first preview, time and clicks | ✅ one prompt | ✅ | ✅ | ✅ | ◐ Five or more steps, two LLM waits, the idea asked twice (§1.2) | **Yes.** |
| Split chat and preview | ✅ resizable | ✅ | ✅ | ✅ | ◐ Fixed 380 px, no mobile (`BuildWorkspace.tsx:517-528`) | **Yes.** |
| Streaming or progress while generating | ✅ | ✅ | ✅ | ✅ | ✗ Spinner only | **Yes.** |
| Plan / discussion mode | ✅ | ✅ | ? | ◐ (spec stage) | ◐ Exists, but its output is not used by Build (`buildChat.ts:201-221`) | **Diff:** plan against personas and journeys and show which persona or stage each page serves. |
| Edit the page I am looking at | ✅ | ✅ | ✅ | ✅ | ✗ Always the homepage (`BuildWorkspace.tsx:187`) | **Yes (P0).** |
| Visual / select-to-edit | ✅ credit-free | ? | ✅ Design Mode | ? | ✗ Canvas; ◐ form editor in Manage | **Yes:** block-level select, then inline text edit, then "ask AI about this block". |
| Version history and restore | ✅ | ✅ checkpoints, bookmarks | ✅ | ✅ draft vs live guard | ◐ Exists, but has no preview or confirm, uses the "live" label wrongly and mutates the draft in place | **Yes:** add preview, confirm, and a "live" label only with a receipt. |
| Draft vs live model | ◐ | ◐ | ◐ | ✅ explicit | ✅ strong server model (BP-03), weak UI | **Diff:** MOSAI's honesty is a real advantage; surface it clearly. |
| One-click publish to a public URL | ✅ `*.lovable.app` | ✅ `*.bolt.host` | ✅ Vercel | ✅ | ✗ Prepared release only; `/shop` needs sign-in | **Yes (P1).** Needs the owner's hosting decision (`docs/decisions/2026-09-24-hosting-public-sites.md`). |
| Custom domains | ✅ paid | ✅ Pro | ✅ | ✅ paid | ✗ ("W3") | **Yes.** Plan placement is an owner question. |
| Database / backend (Supabase or built-in) | ✅ | ✅ | ✅ | ✅ | ✗ for generated sites. MOSAI *is* the backend: Customers, Sell, Convex. | **Diff:** do not bolt on Supabase. Wire forms to Customers, product grids to Sell and events to Grow. |
| GitHub sync / code export | ✅ two-way | ◐ | ✅ PRs | ? | ✗ | **Later / Diff:** blocks are not code. Offer static HTML export and a JSON export first (E3.2 lists GitHub export). |
| Code view / editor | ✅ | ✅ | ✅ | ◐ | ✗ (structured blocks by design) | **No** for websites (the audience is small businesses). Revisit for apps (E3.8). |
| Templates gallery | ✅ | ◐ | ✅ | ✅ App Market | ✗ | **Diff:** "starting points by business type" generated from the project scan rather than a static gallery. |
| Share / remix | ✅ | ◐ | ✅ | ✅ | ✗ | **P2:** share a read-only preview link first (needs the separate origin from rule 9). |
| Theme / brand styling of the output | ✅ | ✅ | ✅ | ✅ | ✗ Dashboard tokens (`PageRenderer.tsx`) | **Yes (P0/P1):** brand kit from the project scan (colours, fonts, logo). |
| Images in the output | ✅ | ✅ | ✅ | ✅ | ✗ Placeholder only; URL-paste assets | **Yes:** upload, the scanned site's imagery, stock (license-checked). |
| Header, nav and footer in the output | ✅ | ✅ | ✅ | ✅ | ✗ Nav exists in the CMS but is not rendered in the preview | **Yes.** |
| Forms → CRM | ◐ via backend | ◐ | ◐ | ◐ | ✗ No form block (`blocks.ts:39-188`) | **Diff (strong):** a form block that writes to Customers with consent. This is MOSAI's moat. |
| Commerce blocks from live catalog | ◐ Stripe | ◐ | ◐ | ◐ | ◐ `productGrid` exists; the generator is told to omit `collectionId` (`buildChat.ts:237`) | **Diff (strong).** |
| Content reuse from other modules | ✗ | ✗ | ✗ | ✗ | ✗ Create pieces are not used by site generation | **Diff (strong).** |
| Persona / journey grounding | ✗ | ✗ | ✗ | ✗ | ◐ In the context pack, but the blueprint is ignored | **Diff:** make it visible (page → persona → stage badges) and editable. |
| SEO / accessibility checks before publish | ◐ | ◐ | ◐ | ? | ◐ Publish checks in `PageEditor` only; claimed on Overview | **Diff:** bring the checks into the workspace publish flow. |
| Credit / usage meter visible | ✅ | ✅ | ✅ | ✅ | ✗ Costs logged in `aiRuns`, never shown | **Yes:** owner decides the unit and prices. |
| Free tier can try Build | ✅ | ✅ | ✅ | ✅ | ✗ Locked on `free` | **Owner question** (§3.1). |
| App generation (code, runtime) | ✅ | ✅ | ✅ | ✅ | ✗ Brief only (honest) | **Later:** blocked on the ADR-3 sandbox decision and owner question 5/6 in STATUS. |

**Where the shared business context is a real advantage:**
- Grounded copy: personas, objections and the brief are in the prompt (`buildChat.ts:67-89`).
- An honest publish model.
- Canonical references to products and assets.
- A single CRM and commerce back end, so there is no Supabase wiring to do.

**Where it is not exploited in Build:**
- The blueprint is ignored.
- The chat never shows *which* persona or journey stage a page serves.
- Create's content is unused.
- There are no forms into Customers.
- `productGrid` is never bound to a collection.
- There is no brand kit from the website scan, even though `project.websiteScan` exists (see `Overview.tsx:556-560`).
- Nothing explains *why* the copy says what it says. For example, "This hero answers Maria's objection: 'too expensive'".

### 3.1 Business-logic review

**How Build is priced and gated today:**
- The plan × module matrix (`capabilities.ts:200-212`) is: `free` = understand, journeys, create. `starter` adds **build**, customers and promote. `growth` adds sell. `scale` includes everything.
- Add-ons can also unlock Build (`billingPlans.ts:297-312` seeds an `addon-build` draft row).
- Prices are catalog rows in integer minor units with Stripe price ids. Seeded rows are €0 drafts (`billingPlans.ts:264-316`). STATUS records that launch plans and prices are not final.
- `build.publish` is a separate capability (`buildWorkspace.ts:287`, `cms.ts:597`). It could gate publish separately from editing, but the plan matrix grants all Build actions together.

**Metering:**
- One flat per-user rate limit applies to all AI across all modules: **30 requests per 10 minutes** (`guards.ts:1619-1620`), independent of plan.
- A 6,000-token full-site generation and a one-line edit each cost "1 request".
- `modelGateway` stores prompt and completion tokens, `providerCredits` and `costMicrousd` per run in `aiRuns` (`modelGateway.ts:78-87`, `guards.ts:1727`). That is enough to meter real cost, but nothing aggregates it per organization or period, enforces a budget, or shows it in `Billing.tsx` (grep: no usage UI).
- So a paying user can run about 4,300 generations a day with no cost ceiling, while a free user cannot try Build at all.

**What drives conversion at competitors:**
1. A **free first result** within a minute, with no card required.
2. A **visible meter** that runs down during a session of real progress.
3. Upgrade prompts at **value moments**: publish to a custom domain, remove the badge, hit the daily cap, make a project private.

MOSAI currently has none of the three for Build.

**Missing pieces:**
- Per-generation usage records rolled up per organization and month.
- A meter component in the Build toolbar.
- Plan-specific budgets.
- A "you've used X of Y" state before a hard failure. Today the limit fails as a toast: "AI request limit reached — wait a few minutes".
- An upgrade call to action from inside Build rather than a redirect.
- A trial path: `trialDays` exists in the catalog (`billingPlans.ts:199-202`) but has no product surface in Build.
- Honest "needs setup" states for hosting and domains that double as upgrade moments.

**Questions for the owner.** These are not decisions; `AGENTS.md` §7 applies to all of them.

1. Should `free` get a **limited Build trial**? For example, generate and preview one site without publishing, or N generations per month. If so, is the limit per organization or per user, and does it refresh daily (Lovable, Bolt, v0) or once (Caffeine)?
2. What is the **billing unit** for Build: requests, credits (a normalized cost unit) or tokens? Should edits be cheaper than full generations, as with Lovable's usage-based Agent mode? Should manual visual edits be free, as Lovable says its Visual Edits are?
3. Should the existing flat 30-per-10-minutes limit stay as an abuse guard only, with a separate **plan budget** layered on top? What happens at exhaustion: a hard stop, top-ups (money, so Stripe, idempotency and receipts per rules 6 and 7), or overage?
4. Which plan includes **public hosting on a MOSAI subdomain**, and which includes **custom domains**? The proposed hosting ADR estimates about $5–6 per month in platform cost plus $0.10 per custom hostname after 100; those figures come from the ADR itself and were not re-verified here. Should free-tier published sites carry a "Made with MOSAI" badge?
5. Is Build sold as its own add-on (`addon-build`) at launch, or only inside `starter`?
6. Freebuff markets itself as "free, no credit meter", and MOSAI's preview runs on a Freebuff host. Is Build positioned against free prompt-to-app tools at all, or as the grounded, CRM-connected option for small businesses who already pay for MOSAI?
7. For apps, STATUS question 5/6 is still open: which audience, and where does the backend live? App generation pricing depends on it.

---

## 4. Prioritized recommendations

Sizes:
- **S:** up to 1 day
- **M:** 2–4 days
- **L:** 1–2 weeks
- **XL:** more than 2 weeks

Each item is one ticket, one branch and one PR, per `AGENTS.md` §8. Schema, OAuth and visual redesign are not combined.

### P0 — fix before anyone compares MOSAI to a competitor

| # | Recommendation | Files | Size | Notes / building blocks |
|---|---|---|---|---|
| P0-1 | **Chat targets the active page.** Pass `activePage._id` to `editPage`. Show "Editing: /pricing" above the composer. Let the model add a page ("create a pricing page") through a new internal op instead of silently editing the homepage. | `BuildWorkspace.tsx` (ChatPanel props, `:184-189`, `:521-526`), `buildChat.ts` (`editPage`) | S | Regression test: edit with `pageId` changes only that page (convex-test). |
| P0-2 | **Use the blueprint and plan in generation.** Load `build.positioning`, `goals`, `differentiators`, `buildPages` (name, path, goal, personaId, journeyStage) and the latest Plan-mode suggestions server-side in `generateSite`. Make plan cards actionable ("Build these pages"). Retire the separate HTML `generatePageDraft` path, or make it write CMS blocks, so there is one page model. | `buildChat.ts:239-396`, `buildPlan.ts:233-278`, `Build.tsx` PagesTab `:478-668`, `BuildWorkspace.tsx:251-270` | M | This is where the differentiator becomes visible. Stop sending prices to the model (§1.6). |
| P0-3 | **Stable block ids across edits.** Ask the model to return existing `id`s for untouched or changed blocks. Mint ids only for new blocks. | `buildChat.ts:466-501` | S | Required for P1-1 (select-to-edit) and for per-block diffs. |
| P0-4 | **Collapse onboarding to one prompt.** New build becomes one prompt field (name derived and editable later), then create, then go straight to the workspace, where generation starts with progress. Drop the duplicate idea screen when an idea exists. | `Build.tsx:112-299`, `:751-774`, `BuildWorkspace.tsx:75-151` | M | Keep the app/website choice as two large cards, not a `<select>`. |
| P0-5 | **Stream progress; run generation as a job.** Record job state (`queued`, then `running`, then `succeeded`/`partially_succeeded`/`failed`) and per-page progress rows that the UI subscribes to. Write each page as soon as it is ready, so the preview fills in page by page. | `buildChat.ts`, new job table plus registry entries (rule 12), `BuildWorkspace.tsx` | L | `@convex-dev/workpool` (Apache-2.0) for the job. `@convex-dev/persistent-text-streaming` (Apache-2.0) for token streaming of the chat reply. The Vercel AI SDK `ai` / `@ai-sdk/react` `useChat` (Apache-2.0) is **not** a drop-in: MOSAI's calls go through `ModelGateway` in Convex actions (rule 11), so prefer the Convex streaming component over an HTTP route. |
| P0-6 | **The build is in the URL.** Route `/app/:projectId/build/:buildId` (plus `?page=/pricing`). Back and refresh work, and links can be shared inside the organization. | `main.tsx`, `App.tsx` ModuleRouter, `Build.tsx:672-749` | S–M | React Router 7 nested route. |
| P0-7 | **Fix delete, and make delete complete.** Make `ConfirmDelete` controllable (`open`/`onOpenChange`) or render it per row. Cascade `buildMessages`, `buildVersions`, `buildReleaseAudits` and progress rows through the data registry, not a hand list (rule 12). | `Build.tsx:776-786`, `module-kit.tsx:140-190`, `builds.ts:499-511`, `dal.ts` | S | Regression test: the dialog opens, and no rows remain after delete. |
| P0-8 | **Truthful labels.** Replace "· live" with "prepared" unless a deployment receipt exists. Change `PageEditor`'s "now live" toast. Rename the toolbar button "Prepare release" (or "Publish" plus a subtitle) until hosting exists. Correct the Overview "SEO/WCAG checks" claim or wire `getReadiness`. | `BuildWorkspace.tsx:413-416`, `:587-594`, `PageEditor.tsx:239-240`, `Overview.tsx:82` | S | Extend `publish-truth.test.ts` with UI string assertions. |
| P0-9 | **One site per website build, stated plainly.** Either block a second website build per project ("This project already has a website — open it") or scope `sites` by build. The first is S; the second is a schema change and needs an owner call on multi-site (W8). | `Build.tsx` NewBuildForm, `buildInternals.ts:179-196` | S (block) | |
| P0-10 | **Output looks like a real website.** Render the site's navigation (header) and a footer in the preview and storefront. Make `hero.ctaHref` and `cta.buttonHref` real `<a>` elements, validated with internal paths only or `https:`. Give sites their own theme scope (CSS variables on a wrapper) instead of dashboard tokens. | `PageRenderer.tsx`, `StorefrontApp.tsx`, `lib/cms/blocks.ts` | M | Links need an allow-list validator (no `javascript:`). Covered by `sanitized-html.spec.ts`. |

### P1 — reach parity on the core loop

| # | Recommendation | Files | Size | Building blocks (license) |
|---|---|---|---|---|
| P1-1 | **Select-to-edit on the preview.** Hover outlines a block. Clicking it opens an inspector with the block's fields (reusing `BlockFieldInput`) plus "Ask AI about this block". Text fields support inline contenteditable. Manual edits save a draft and a version **with no AI charge**. | new `src/components/build/PreviewCanvas.tsx`, `BlockInspector.tsx`; extract `BlockFieldInput` from `PageEditor.tsx:667-780` | L | **Puck** (`@puckeditor/core`, formerly `@measured/puck`, MIT). This is already the W2 plan (`WEBSITE-EXECUTION-PLAN.md`): run the six-question spike against `PageDocument`. Alternatives: **Craft.js** (`@craftjs/core`, MIT, lower-level) and **GrapesJS** (BSD-3-Clause; HTML/CSS-centric, a poor fit for the structured-block rule). **@dnd-kit/core** (MIT) handles drag reorder if Puck is rejected. |
| P1-2 | **Resizable split, device preview and mobile layout.** Use the existing `ui/resizable.tsx` with a persisted size. Add a desktop, tablet and mobile width toggle. On small screens, show tabs for Chat and Preview, or put the chat in `ui/sheet.tsx`. | `BuildWorkspace.tsx:517-658` | S–M | `react-resizable-panels` (MIT). Already installed at ^3; latest is 4.x, so check the changelog before upgrading. |
| P1-3 | **Versions: preview, confirm and bookmark.** Use `ui/dropdown-menu`. Hovering or clicking a version previews it read-only, with "Restore as new draft" and a confirm step. Insert a new draft revision instead of patching (§1.3 row 15). Allow pinning or renaming, as Bolt does. Show which version is prepared or live. | `BuildWorkspace.tsx:336-433`, `buildWorkspace.ts:210-260` | M | — |
| P1-4 | **Publish flow in the workspace.** Add a sheet with the per-page checks from `cms.getPublishChecks` and `builds.getReadiness`, with "Fix with AI" links per issue. The delivery state comes from `getSiteDelivery`. Hosting shows as `needs_setup` with the next step. | `BuildWorkspace.tsx`, reuse `PageEditor.tsx:597-665` | M | — |
| P1-5 | **Public hosting on a MOSAI subdomain** once the owner accepts the hosting ADR. Prerender a snapshot at publish, upload it to the edge, then write the `buildDeployments` receipt. This is BP-13 / E3.2. | new deployment adapter, `buildWorkspace.ts`, separate registrable domain (rule 9) | XL | Cloudflare Workers + R2 per the ADR. Needs an owner decision (§3.1 Q4). |
| P1-6 | **Brand kit from business context.** Derive colours, fonts and logo from `project.websiteScan` or an upload. Store them on `sites`, let the user edit them in Site settings and apply them in `PageRenderer`. | `SitePanel.tsx` SettingsTab, `cms.ts`, `PageRenderer.tsx`, schema (additive) | M | Any colour extraction must run on server-fetched data through `safeFetch` (rule 8). |
| P1-7 | **Real images.** Upload to Convex storage (files already exist in `files.ts`) and add "use images from my website scan". Let the generator bind `image.assetId` from the project's assets. | `SitePanel.tsx:457-568`, `buildChat.ts` prompt, `cms.ts` | M | — |
| P1-8 | **Usage meter and upgrade moments** (after the owner answers §3.1 Q1–Q3). Roll up `aiRuns` per organization and period into a `usageLedger`. Show a toolbar chip ("12 of 50 generations this month") and a warning state before the hard stop. A locked Build shows a **preview page** with a sample generated from the user's own brief and an upgrade call to action, instead of `<Navigate>`. | `guards.ts` (quota), new `usage.ts`, `BuildWorkspace.tsx`, `App.tsx:104-107`, `Billing.tsx` | L | `@convex-dev/rate-limiter` (Apache-2.0) could replace the hand-rolled bucket. Keep the money logic server-side with receipts (rules 6 and 7). |
| P1-9 | **Show the grounding.** On each page tab and in each assistant reply, show chips such as "serves: Maria (Owner) · stage: Consider". Add an "Explain this copy" action that cites the persona objection or goal used. | `BuildWorkspace.tsx`, `buildChat.ts` (return `sourceRefs` from generation) | M | This is MOSAI's differentiator made visible. Competitors cannot copy it without the context model. |

### P2 — differentiate and extend

| # | Recommendation | Files | Size | Building blocks (license) |
|---|---|---|---|---|
| P2-1 | **Form block → Customers**, with consent capture and a submission receipt (W4). | `lib/cms/blocks.ts`, `PageRenderer.tsx`, a Customers public intake endpoint on the separate origin | L | Capability check via the action registry (module contract, rule 10). |
| P2-2 | **Commerce-aware generation.** The generator may choose `productGrid.collectionId` from the project's collections (ids only), and the preview resolves live Sell data (W5). | `buildChat.ts:227-237`, `PageRenderer.tsx:173-298` | M | — |
| P2-3 | **Reuse Create content.** Offer "Use my published articles and FAQs": content pieces are passed as canonical references, with blog and FAQ page types. | `buildChat.ts`, `cms.ts` | M | Cross-module read through canonical references and events only (rule 10). |
| P2-4 | **Starting points by business type** instead of a static template gallery. After the project scan, offer 3 structural variants (for example "Local service", "Shop-first", "Lead-gen"), each rendered from the user's own brief. | new `src/components/build/StartingPoints.tsx`, `buildChat.ts` | M | shadcn blocks (MIT) can inspire section layouts, but they must be re-expressed as registry blocks, not pasted JSX. |
| P2-5 | **Share preview link and remix within the organization.** A signed, expiring read-only preview URL on the public-content domain. "Duplicate build" inside the organization. | hosting layer, `builds.ts` | M | Rule 9: never on the app origin. |
| P2-6 | **Export.** Static HTML/ZIP plus a `PageDocument` JSON export, then GitHub export with a parity test (E3.2). | new export action | L | — |
| P2-7 | **AI assist in the app brief** (prefill workflows and target users from personas and journeys; suggest constraints). This stays honest that nothing runs until ADR-3. | `AppWorkspace.tsx`, a new `build.app_brief` agent through `ModelGateway` | M | App code preview later: **Sandpack** (`@codesandbox/sandpack-react`, Apache-2.0) for client-only previews. **Monaco** (`@monaco-editor/react`, MIT) or **CodeMirror 6** (`@uiw/react-codemirror`, MIT) for a code view. CodeMirror is much lighter for an optional panel. All of these are blocked on the E3.8 sandbox decision. |

### Suggested order

1. **Week 1:**
   - P0-1, P0-3, P0-6, P0-7 and P0-8 (all S).
   - Then P0-2 and P0-9.
2. **Week 2:**
   - P0-4 and P0-10.
   - P1-2 and P1-3.
3. **Then:**
   - P0-5 (job and streaming), P1-4, P1-9.
   - The Puck spike (P1-1).
   - P1-6 and P1-7.
4. **Blocked on the owner:**
   - P1-5 (hosting ADR, domains).
   - P1-8 (pricing unit, budgets, free trial).

Library license and version facts come from the npm registry (`registry.npmjs.org/<pkg>/latest`), queried 24 Sep 2026:

- react-resizable-panels 4.13.3, MIT
- @puckeditor/core 0.23.0, MIT
- @measured/puck 0.20.2, MIT
- @craftjs/core 0.2.12, MIT
- grapesjs 0.23.6, BSD-3-Clause
- @dnd-kit/core 6.3.1, MIT
- @monaco-editor/react 4.7.0, MIT
- @uiw/react-codemirror 4.25.12, MIT
- @codesandbox/sandpack-react 2.20.0, Apache-2.0
- ai 7.0.114, Apache-2.0
- @ai-sdk/react 4.0.117, Apache-2.0
- @convex-dev/persistent-text-streaming 0.3.3, Apache-2.0
- @convex-dev/workpool 0.4.12, Apache-2.0
- @convex-dev/rate-limiter 0.4.0, Apache-2.0

Any adoption must follow `AGENTS.md` §8 ("no framework not named in the ticket or an accepted ADR") and update `THIRD_PARTY_NOTICES.md`.

---

## Sources (accessed 24 Sep 2026; all via web-search summaries, as direct fetches were blocked)

- Lovable:
  - [Plan mode FAQ](https://lovable.dev/faq/ai-agent/plan-mode)
  - [Agent mode blog](https://lovable.dev/blog/agent-mode-beta)
  - [Credits and usage](https://docs.lovable.dev/introduction/credits-and-usage)
  - [Changelog](https://docs.lovable.dev/changelog)
  - [Publish guide](https://lovable.dev/guides/how-to-publish-a-web-app)
  - [Remix docs](https://docs.lovable.dev/features/projects/remix)
  - [Remix FAQ](https://lovable.dev/faq/team/sharing/remix-copy-project)
  - [softr.io pricing guide](https://www.softr.io/blog/lovable-pricing)
  - [nocode.mba pricing](https://www.nocode.mba/articles/lovable-pricing)
  - [nocode.mba tutorial](https://www.nocode.mba/articles/how-to-use-lovable)
- Bolt:
  - [Tokens](https://support.bolt.new/account-and-subscription/tokens)
  - [Rollback/version history](https://support.bolt.new/building/using-bolt/rollback-backup)
  - [Hosting](https://support.bolt.new/cloud/hosting)
  - [Docs index](https://support.bolt.new/llms.txt)
  - [banani.co pricing](https://www.banani.co/blog/bolt-new-pricing)
  - [shipper.now custom domain](https://shipper.now/bolt-custom-domain/)
- v0:
  - [Updated v0 pricing](https://vercel.com/blog/updated-v0-pricing)
  - [v0 FAQs](https://v0.app/docs/faqs)
  - [nocode.mba v0 pricing](https://www.nocode.mba/articles/v0-pricing)
  - [nxcode.io guide](https://www.nxcode.io/resources/news/v0-by-vercel-complete-guide-2026)
- Caffeine:
  - [Plans and Pricing](https://help.caffeine.ai/hc/en-us/articles/46899796807060-Plans-and-Pricing)
  - [App Market](https://caffeine.ai/app-market)
  - [windowsforum summary](https://windowsforum.com/threads/caffeine-ai-build-apps-via-chat-with-spec-code-draft-and-live-stages.409340/)
  - [hostadvice review](https://hostadvice.com/ai-app-builders/caffeine-ai-review/)
- Freebuff:
  - [freebuff.com/web](https://freebuff.com/web)
  - [freebuff.com](https://freebuff.com/)
  - [bitdoze review](https://www.bitdoze.com/freebuff-free-ai-coding-agent/)

**Not verified (explicitly):**
- Bolt select-element / visual edit and GitHub sync.
- Freebuff Web's editor features.
- Caffeine's editing UX beyond draft/live/rollback.
- Exact current prices on any vendor's own pricing page.
- The v0 Premium plan sunset date.
