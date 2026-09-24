// PLACEHOLDER: replaced by the renderer agent's version at merge.
/**
 * Minimal static HTML renderer for MOSAI-hosted customer websites.
 *
 * Contract (shared with the renderer agent): pure, no Convex imports, emits
 * no `<script>` and escapes every value it prints. Block props are data,
 * never markup — this placeholder prints only their string leaves as text.
 */

export type RenderSitePageInput = {
  siteName: string;
  basePath: string;
  page: {
    title: string;
    fullPath: string;
    seo?: {
      title?: string;
      metaDescription?: string;
      noindex?: boolean;
      ogImageUrl?: string;
    };
    blocks: { id: string; type: string; version: number; props: unknown }[];
  };
  nav: { title: string; href: string }[];
  canonicalUrl?: string;
};

/** No scripts, no remote code; inline styles only; images from https. */
export const PUBLIC_SITE_CSP =
  "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textLeaves(value: unknown, out: string[], depth = 0): void {
  if (depth > 6 || out.length > 200) return;
  if (typeof value === "string") {
    const trimmed = value.replace(/<[^>]*>/g, " ").trim();
    if (trimmed) out.push(trimmed);
  } else if (Array.isArray(value)) {
    for (const item of value) textLeaves(item, out, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) textLeaves(item, out, depth + 1);
  }
}

function shell(title: string, head: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>${head}</head><body>${body}</body></html>`;
}

export function renderSitePage(input: RenderSitePageInput): string {
  const { page } = input;
  const title = page.seo?.title || `${page.title} · ${input.siteName}`;
  const head = [
    page.seo?.metaDescription
      ? `<meta name="description" content="${esc(page.seo.metaDescription)}">`
      : "",
    page.seo?.noindex ? `<meta name="robots" content="noindex">` : "",
    input.canonicalUrl ? `<link rel="canonical" href="${esc(input.canonicalUrl)}">` : "",
  ].join("");
  const nav = input.nav
    .map((item) => `<li><a href="${esc(item.href)}">${esc(item.title)}</a></li>`)
    .join("");
  const blocks = page.blocks
    .map((block) => {
      const texts: string[] = [];
      textLeaves(block.props, texts);
      return `<section data-block="${esc(block.type)}">${texts
        .map((text) => `<p>${esc(text)}</p>`)
        .join("")}</section>`;
    })
    .join("");
  return shell(
    title,
    head,
    `<header><strong>${esc(input.siteName)}</strong><nav><ul>${nav}</ul></nav></header><main><h1>${esc(page.title)}</h1>${blocks}</main>`,
  );
}

export function renderNotFoundPage(
  input: { siteName?: string; basePath?: string } = {},
): string {
  const home = input.basePath
    ? `<p><a href="${esc(`${input.basePath}/`)}">Go to the home page</a></p>`
    : "";
  return shell(
    input.siteName ? `Page not found · ${input.siteName}` : "Page not found",
    `<meta name="robots" content="noindex">`,
    `<main><h1>Page not found</h1><p>This page does not exist or is not published.</p>${home}</main>`,
  );
}
