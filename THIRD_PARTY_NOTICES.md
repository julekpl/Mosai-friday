# Third-party notices

This project incorporates or derives from the following open-source software.

## svelte-commerce

- **Source:** https://github.com/itswadesh/svelte-commerce
- **Copyright:** © 2025 Misiki & contributors
- **License:** MIT (https://opensource.org/licenses/MIT)
- **Used in:** the Shopify commerce read connector
  (`src/convex/shopifySync.ts`, `src/lib/cms/commerceConnector.ts`) derives
  its normalized product/variant/media mapping and Storefront API endpoint
  usage from the `@misiki/shopify-connector` package. Ported patterns
  (normalized commerce surface, honest capability matrix, provider-authority
  semantics) are credited here per the MIT license.
