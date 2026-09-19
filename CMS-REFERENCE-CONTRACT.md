# CMS-REFERENCE-CONTRACT.md
# CMS-PUBLISHING-CONTRACT.md

Status: W1 contract · created 2026-09-19

## Reference shape

```ts
EntityReference { type: "page" | "asset" | "collection" | "product" | "form", id: string }
```

## Where references appear

- `image.assetId`, `hero.imageAssetId` → cmsAssets
- `productGrid.collectionId` → collections (Sell owns truth)
- link fields (cta.buttonHref etc.) — plain paths in W1; entity-typed links
  planned for W2 (broken-link detection)
- Navigation items `{ type: "page", referenceId } | { type: "external", url }`

## Resolver

`resolvePageByPath(siteId, fullPath)` is the single read path for public
rendering: it resolves site → page by fullPath → publishedRevisionId →
revision. It can never return a draft. Draft preview resolves the draft
revision explicitly and is always labeled preview.

## Publishing contract

1. Publish = promote the current draft revision:
   - new revision row written with document snapshot, `state: published`,
     `version = prev.published + 1`
   - page.publishedRevisionId points at it atomically
   - previous published revision marked `superseded`
2. Draft autosave never publishes. `Saved` ≠ `Published`.
3. Pre-publish checks:
   - blocking: missing referenced asset, invalid collectionId, no homepage
     when publishing homepageless site root path, duplicate fullPath
   - recommendation: missing meta description, missing alt text, long title
4. Path change of a *published* page offers an auto redirect (301) from the
   old fullPath; redirect loops are rejected.
5. Archive/delete is refused while other published pages link to the path.

## Error experience (blueprint §116)

User-facing publish issues name the block and the fix
("Product Grid on this page points to a collection that no longer exists —
choose another collection"), never raw codes.
