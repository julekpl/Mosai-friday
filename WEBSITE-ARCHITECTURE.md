# WEBSITE-ARCHITECTURE.md

Status: W0 contract · created 2026-09-19

## Domain ownership

| Domain | Owns |
|---|---|
| CMS | Site, Page, PageRevision, PageDocument, ReusableSection, Navigation, Redirect, Asset metadata, SEO config, FormDefinition, Site settings, Theme, Domain mapping, Publication state |
| Sell | Product, Variant, Collection, Inventory, Price, Availability, Feed, Order/Cart/Checkout (W7) |
| Customers | Contact, Consent, Segments, Activity |
| Content | Article assets, draft copy, campaign copy, reusable editorial content |

CMS *references* those objects. Never duplicates their truth.

## Page model

Page identity and revision content are separate:

```text
Page          identity: siteId, title, slug, parentId, pageType,
              status, publishedRevisionId?, latestDraftRevisionId?, seo
PageRevision  content:  version, state (draft|published|superseded),
              document (PageDocument), createdBy, publishedAt
```

Rules locked in W1:

1. Published content is immutable revisions.
2. Editing never modifies a published revision in place — editing a published
   page creates a newer draft.
3. Public reads can never return a draft.
4. Page documents are structured JSON (blocks), never canonical HTML.
5. Blocks carry stable client-generated IDs and registry versions.
6. Restoring a version creates a new draft; history is never overwritten.
7. Publishing promotes the draft atomically and marks prior published
   revision `superseded`.
8. Deleting/archiving a page blocks when other published pages link to it,
   and offers redirect creation when a published path changes.

## PageDocument schema (v1)

```ts
PageDocument {
  schemaVersion: 1
  blocks: Block[]
}
Block {
  id: string            // client-generated, stable
  type: string          // registry key
  version: number       // registry block version
  props: object         // validated against the registry
}
```

Registry (W1 set): `hero`, `richText`, `image`, `quote`, `cta`, `featureGrid`,
`faq`, `spacer`, `divider`, `stats`, `productGrid` (W5 shell — stores
collectionId only).

## Reference contract

Every cross-domain pointer is `{ type, id }` (EntityReference). Types:
`page`, `asset`, `collection`, `product`, `form`. Central resolver validates
references at save (schema) and publish (existence).

## Validation split

- **Save-time (schema):** known block type/version, field validation.
- **Publish-time (readiness):** missing referenced asset/page, duplicate URL,
  invalid product/collection reference, missing meta description (warning).

Blocking issues prevent publish; recommendations never do.

## Convex tables (W1)

```text
sites          one per project (extensible to many later)
cmsPages       page tree: siteId, parentId, slug, fullPath, pageType, status
pageRevisions  draft/published/superseded document snapshots
cmsAssets      canonical asset references (URL-based in W1; storage later)
cmsNavigations menus: ordered items typed page|external|collection
cmsRedirects   fromPath → to, 301/302, loop-safe
```

Indexes: `by_project` everywhere, `by_site` on pages, `by_page` on revisions,
`by_site_path` unique-ish lookup for resolve-by-path.
