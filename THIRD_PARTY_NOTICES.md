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

## open-lovable

- **Source:** https://github.com/firecrawl/open-lovable (commit `69bd93b`, 19 Nov 2025)
- **Copyright:** © 2024 the open-lovable contributors (Firecrawl)
- **License:** MIT (https://opensource.org/licenses/MIT)
- **Used in:** the app builder generator (`src/convex/modules/buildApp/generate.ts`)
  and source protocol (`src/shared/appBuilder/source.ts`). Ported: the system
  prompt rules for generating and surgically editing a React + Tailwind app,
  the `<file path>` / `<package>` reply protocol and its parser, truncated-file
  completion, and the idea behind its edit-context file selection. Not ported:
  its Next.js API routes, Vercel/E2B sandbox layer, Firecrawl scraping and
  direct provider SDK calls; MOSAI runs generation through `ModelGateway` and
  previews in the browser with Sandpack.

## Sandpack

- **Source:** https://github.com/codesandbox/sandpack (`@codesandbox/sandpack-react`)
- **License:** Apache-2.0 (https://www.apache.org/licenses/LICENSE-2.0)
- **Used in:** the app builder preview (`src/components/build/app/AppPreview.tsx`),
  as an npm dependency.
