import type { BrandUse } from "@/convex/lib/brandProfile";

export const BRAND_USE_COPY: Record<BrandUse, { name: string; module: string; detail: string }> = {
  content: { name: "Content and messages", module: "Create", detail: "Articles, emails, landing copy and marketing messages" },
  social: { name: "Social posts and ads", module: "Promote", detail: "Post and ad copy, plus colours and imagery for visuals" },
  website: { name: "Website and app", module: "Build", detail: "Page copy, colours, fonts and corner style" },
  shop: { name: "Product copy", module: "Sell", detail: "Product descriptions and SEO text" },
  research: { name: "Customer research", module: "Understand, Journeys", detail: "Off by default so personas and journeys stay neutral" },
};
