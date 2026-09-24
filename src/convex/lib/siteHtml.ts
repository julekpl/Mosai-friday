/* ── Public site renderer (server-rendered static HTML, no JavaScript) ─────
 *
 * Customer websites are served at `appmosai.com/s/<slug>-website/<path>` as
 * static HTML. The public site shares the dashboard origin for now, so the
 * page this module produces must never be able to run script:
 *
 *   - no <script>, inline event handler, <iframe>/<object>/<embed>, <form>,
 *     <base>, or <meta http-equiv>;
 *   - every href is http(s), mailto, tel, a site path starting with "/" or a
 *     "#fragment" (see `safeHref`); every image src is https or a raster
 *     `data:image/…` URL (see `safeImageSrc`);
 *   - all text and attribute values are escaped;
 *   - rich text is RE-sanitized here with a small allow-list tokenizer of its
 *     own (`sanitizeRichText`), even though `sanitizeDocument` cleaned it on
 *     save: the renderer never trusts stored HTML.
 *
 * Block props are `unknown`: every renderer validates shapes defensively and
 * never throws. Unknown block types are skipped silently. `PUBLIC_SITE_CSP`
 * is the header the hosting layer sends with every page as a second line of
 * defence.
 *
 * Pure TypeScript — no DOM, no React, no Convex imports — so it runs inside a
 * Convex HTTP action (V8 runtime) and in unit tests.
 */

export type SiteNavItem = { title: string; href: string };
export type SiteBlock = { id: string; type: string; version: number; props: unknown };
export type RenderSitePageInput = {
  siteName: string;
  basePath: string; // e.g. "/s/acme-website" (no trailing slash)
  page: {
    title: string;
    fullPath: string; // "/" or "/about"
    seo?: { title?: string; metaDescription?: string; noindex?: boolean; ogImageUrl?: string };
    blocks: SiteBlock[];
  };
  nav: SiteNavItem[]; // hrefs already absolute paths under basePath
  canonicalUrl?: string;
};

export const PUBLIC_SITE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MOSAI_HOME_URL = "https://appmosai.com/";

/* ── Escaping ───────────────────────────────────────────────────────────── */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A prop as display text: strings and finite numbers only, trimmed and capped. */
function text(value: unknown, max = 5000): string {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .filter((item) => item !== null && typeof item === "object" && !Array.isArray(item))
    .map((item) => item as Record<string, unknown>);
}

/* ── Entities ───────────────────────────────────────────────────────────── */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  euro: "€",
  pound: "£",
  middot: "·",
  bull: "•",
};

/**
 * Decode character references the way a browser would before interpreting
 * an attribute or text (numeric references without a trailing ";" included).
 * Unknown named references are left literal; the result is always escaped
 * again on output, so what the browser sees is exactly what was validated.
 */
export function decodeEntities(value: string): string {
  return value.replace(
    /&(?:#[xX]([0-9a-fA-F]{1,6});?|#([0-9]{1,7});?|([a-zA-Z][a-zA-Z0-9]{1,31});)/g,
    (match, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
      if (hex !== undefined || dec !== undefined) {
        const code = hex !== undefined ? parseInt(hex, 16) : parseInt(dec ?? "", 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "�";
        if (code >= 0xd800 && code <= 0xdfff) return "�";
        return String.fromCodePoint(code);
      }
      const named = name !== undefined ? NAMED_ENTITIES[name] : undefined;
      return named ?? match;
    },
  );
}

/* ── URL policy ─────────────────────────────────────────────────────────── */

/** True when the string holds a C0/C1 control character. */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Browsers drop tab/CR/LF anywhere in a URL, which is how `java\tscript:`
  // sneaks past naive checks; remove them before looking at the scheme.
  const decoded = decodeEntities(raw).replace(/[\t\n\r]/g, "").trim();
  if (decoded === "" || decoded.length > 2048) return null;
  if (hasControlChar(decoded)) return null;
  if (decoded.includes("\\")) return null;
  return decoded;
}

function scheme(url: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  return m ? m[1].toLowerCase() : null;
}

/**
 * A link target the public site may emit, or null. Allowed: http(s),
 * mailto, tel, "#fragment", and site paths starting with a single "/".
 * Site paths are resolved under `basePath` when given (block and rich-text
 * links are stored relative to the site root, e.g. "/contact"); a path
 * already under `basePath` is left as it is.
 */
export function safeHref(raw: unknown, basePath?: string): string | null {
  const url = normalizeUrl(raw);
  if (url === null) return null;
  if (url.startsWith("#")) return url;
  if (url.startsWith("/")) {
    if (url.startsWith("//")) return null; // protocol-relative: a different host
    if (!basePath) return url;
    if (url === basePath || url.startsWith(`${basePath}/`) || url.startsWith(`${basePath}?`) || url.startsWith(`${basePath}#`)) {
      return url;
    }
    return url === "/" ? `${basePath}/` : `${basePath}${url}`;
  }
  const s = scheme(url);
  if (s === "http" || s === "https") {
    return /^https?:\/\/[^/?#\s]/i.test(url) ? url : null;
  }
  if (s === "mailto" || s === "tel") return url;
  return null;
}

function isExternal(href: string): boolean {
  return /^https?:/i.test(href);
}

/** An image source the public site may emit: https, or a raster data URL. */
export function safeImageSrc(raw: unknown): string | null {
  const url = normalizeUrl(raw);
  if (url === null) return null;
  if (/^https:\/\/[^/?#\s]/i.test(url)) return url;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(url) && url.length <= 2_000_000) {
    return url;
  }
  return null;
}

function ogImageUrl(raw: unknown): string | null {
  const url = normalizeUrl(raw);
  return url !== null && /^https:\/\/[^/?#\s]/i.test(url) ? url : null;
}

function safeHttpUrl(raw: unknown): string | null {
  const url = normalizeUrl(raw);
  if (url === null) return null;
  return /^https?:\/\/[^/?#\s]/i.test(url) ? url : null;
}

/* ── Rich-text allow-list sanitizer ─────────────────────────────────────── */

const RICH_ALLOWED = new Set([
  "p",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
  "br",
  "blockquote",
  "code",
]);

/** Tags mapped onto an allowed equivalent instead of being dropped. */
const RICH_ALIASES: Record<string, string> = {
  h1: "h2",
  h5: "h4",
  h6: "h4",
  b: "strong",
  i: "em",
};

/** Elements whose entire content is discarded, not just the tag. */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "noembed",
  "noframes",
  "svg",
  "math",
  "textarea",
  "title",
  "xmp",
  "select",
  "option",
  "head",
  "applet",
  "frameset",
  "plaintext",
]);

const VOID_ELEMENTS = new Set(["br", "img", "hr", "input", "meta", "link", "base", "wbr", "source", "area", "col", "embed", "param", "track"]);

/** Index of the ">" ending a tag that starts at `from`, honouring quotes. */
function findTagEnd(html: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
}

function parseAttributes(raw: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/**
 * Re-sanitize stored rich text with a strict allow-list. Output contains only
 * `p, h2–h4, ul, ol, li, strong, em, a[href], br, blockquote, code` with no
 * attributes other than a validated `href` (plus fixed `rel`) on links. Every
 * other tag is dropped (its text kept, except for script-like elements whose
 * content is dropped too); all text is decoded and re-escaped; the element
 * tree is balanced so the fragment cannot close the surrounding markup.
 */
export function sanitizeRichText(input: unknown, basePath?: string): string {
  if (typeof input !== "string" || input === "") return "";
  const html = input.slice(0, 200_000);
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;

  const emitText = (raw: string) => {
    if (raw) out.push(escapeHtml(decodeEntities(raw)));
  };

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      emitText(html.slice(i));
      break;
    }
    emitText(html.slice(i, lt));
    const next = html[lt + 1] ?? "";

    // Comments, doctype, CDATA, processing instructions: dropped.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", lt + 2);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const closing = next === "/";
    const nameStart = closing ? lt + 2 : lt + 1;
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(html.slice(nameStart, nameStart + 64));
    if (!nameMatch) {
      // A bare "<" that does not start a tag is text.
      out.push("&lt;");
      i = lt + 1;
      continue;
    }
    const rawName = nameMatch[0].toLowerCase();
    const tagEnd = findTagEnd(html, nameStart + nameMatch[0].length);
    if (tagEnd === -1) break; // unterminated tag: drop the remainder
    const attrSource = html.slice(nameStart + nameMatch[0].length, tagEnd);
    i = tagEnd + 1;

    if (!closing && DROP_WITH_CONTENT.has(rawName)) {
      if (VOID_ELEMENTS.has(rawName) || /\/\s*$/.test(attrSource)) continue;
      const closeRe = new RegExp(`</${rawName}[\\s/>]`, "ig");
      closeRe.lastIndex = i;
      const close = closeRe.exec(html);
      if (!close) {
        i = html.length;
        break;
      }
      const closeEnd = findTagEnd(html, close.index + 2);
      i = closeEnd === -1 ? html.length : closeEnd + 1;
      continue;
    }

    const name = RICH_ALIASES[rawName] ?? rawName;
    if (!RICH_ALLOWED.has(name)) continue;

    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    if (name === "br") {
      out.push("<br>");
      continue;
    }
    if (name === "a") {
      const href = safeHref(parseAttributes(attrSource).get("href"), basePath);
      out.push(href ? `<a href="${escapeHtml(href)}" rel="noopener nofollow">` : "<a>");
    } else {
      out.push(`<${name}>`);
    }
    stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join("");
}

/* ── Blocks ─────────────────────────────────────────────────────────────── */

type RenderContext = { basePath: string; h1Used: boolean };

function linkAttrs(href: string): string {
  return isExternal(href)
    ? `href="${escapeHtml(href)}" rel="noopener"`
    : `href="${escapeHtml(href)}"`;
}

function button(labelRaw: unknown, hrefRaw: unknown, ctx: RenderContext, variant = "primary"): string {
  const label = text(labelRaw, 120);
  const href = safeHref(hrefRaw, ctx.basePath);
  if (!label || !href) return "";
  return `<a class="button button-${variant}" ${linkAttrs(href)}>${escapeHtml(label)}</a>`;
}

function img(srcRaw: unknown, altRaw: unknown, className: string): string {
  const src = safeImageSrc(srcRaw);
  if (!src) return "";
  const alt = text(altRaw, 300);
  return `<img class="${className}" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`;
}

function renderHero(p: Record<string, unknown>, ctx: RenderContext): string {
  const heading = text(p.heading, 300);
  const body = text(p.body);
  const eyebrow = text(p.eyebrow, 120);
  if (!heading && !body) return "";
  const level = ctx.h1Used || !heading ? "h2" : "h1";
  if (heading) ctx.h1Used = true;
  const image = img(p.imageUrl ?? p.imageAssetUrl ?? p.assetUrl, p.imageAlt ?? p.alt, "hero-image");
  const cta = button(p.ctaLabel, p.ctaHref, ctx);
  const align = p.align === "center" ? " hero-center" : "";
  return `<section class="block hero${align}${image ? " hero-with-image" : ""}"><div class="hero-copy">${
    eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ""
  }${heading ? `<${level} class="hero-title">${escapeHtml(heading)}</${level}>` : ""}${
    body ? `<p class="lead">${escapeHtml(body)}</p>` : ""
  }${cta ? `<p class="actions">${cta}</p>` : ""}</div>${image ? `<div class="hero-media">${image}</div>` : ""}</section>`;
}

function renderRichText(p: Record<string, unknown>, ctx: RenderContext): string {
  const html = sanitizeRichText(p.html, ctx.basePath);
  if (!html) return "";
  return `<section class="block prose">${html}</section>`;
}

function renderImage(p: Record<string, unknown>): string {
  const image = img(p.assetUrl ?? p.imageUrl ?? p.url ?? p.src, p.alt, "figure-image");
  if (!image) return "";
  const caption = text(p.caption, 500);
  return `<figure class="block figure">${image}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
}

function renderQuote(p: Record<string, unknown>): string {
  const quote = text(p.text);
  if (!quote) return "";
  const attribution = text(p.attribution, 200);
  return `<figure class="block quote"><blockquote><p>${escapeHtml(quote)}</p></blockquote>${
    attribution ? `<figcaption>${escapeHtml(attribution)}</figcaption>` : ""
  }</figure>`;
}

function renderCta(p: Record<string, unknown>, ctx: RenderContext): string {
  const heading = text(p.heading, 300);
  const body = text(p.body);
  const cta = button(p.buttonLabel, p.buttonHref, ctx);
  if (!heading && !cta) return "";
  return `<section class="block cta">${heading ? `<h2>${escapeHtml(heading)}</h2>` : ""}${
    body ? `<p>${escapeHtml(body)}</p>` : ""
  }${cta ? `<p class="actions">${cta}</p>` : ""}</section>`;
}

function sectionHeading(p: Record<string, unknown>): string {
  const heading = text(p.heading, 300);
  return heading ? `<h2 class="section-title">${escapeHtml(heading)}</h2>` : "";
}

function renderFeatureGrid(p: Record<string, unknown>): string {
  const items = list(p.items, 12)
    .map((item) => ({ title: text(item.title, 200), body: text(item.body, 2000) }))
    .filter((item) => item.title || item.body);
  if (!items.length) return "";
  return `<section class="block features">${sectionHeading(p)}<ul class="feature-list" role="list">${items
    .map(
      (item) =>
        `<li class="feature">${item.title ? `<h3>${escapeHtml(item.title)}</h3>` : ""}${
          item.body ? `<p>${escapeHtml(item.body)}</p>` : ""
        }</li>`,
    )
    .join("")}</ul></section>`;
}

function renderFaq(p: Record<string, unknown>): string {
  const items = list(p.items, 50)
    .map((item) => ({ q: text(item.question, 500), a: text(item.answer) }))
    .filter((item) => item.q && item.a);
  if (!items.length) return "";
  const heading = sectionHeading(p) || `<h2 class="section-title">Frequently asked questions</h2>`;
  return `<section class="block faq">${heading}<div class="faq-list">${items
    .map(
      (item) =>
        `<details class="faq-item"><summary><h3>${escapeHtml(item.q)}</h3></summary><p>${escapeHtml(item.a)}</p></details>`,
    )
    .join("")}</div></section>`;
}

function renderStats(p: Record<string, unknown>): string {
  const items = list(p.items, 12)
    .map((item) => ({ value: text(item.value, 40), label: text(item.label, 200) }))
    .filter((item) => item.value && item.label);
  if (!items.length) return "";
  return `<section class="block stats"><dl class="stat-list">${items
    .map(
      (item) =>
        `<div class="stat"><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`,
    )
    .join("")}</dl></section>`;
}

function renderSpacer(p: Record<string, unknown>): string {
  const raw = typeof p.height === "number" ? p.height : text(p.height) ? Number(text(p.height)) : NaN;
  const height = Number.isFinite(raw) ? Math.round(Math.min(Math.max(raw, 0), 200)) : 48;
  return `<div class="spacer" style="height:${height}px" aria-hidden="true"></div>`;
}

function formatMoney(minor: number, currency: string): string {
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "";
  try {
    if (code) {
      return new Intl.NumberFormat("en", { style: "currency", currency: code }).format(minor / 100);
    }
  } catch {
    // fall through to the plain format
  }
  return `${(minor / 100).toFixed(2)}${code ? ` ${code}` : ""}`;
}

/**
 * Product grid. Pages store only a collection id; product facts come from
 * Sell at render time. The host passes them in as `resolvedProducts`
 * (`{ title, priceCents, currency, availability, imageUrl, externalUrl }`).
 * Without resolved products nothing is rendered — never placeholder data.
 */
function renderProductGrid(p: Record<string, unknown>, ctx: RenderContext): string {
  const products = list(p.resolvedProducts, 48)
    .map((item) => ({
      title: text(item.title, 200),
      price:
        typeof item.priceCents === "number" && Number.isInteger(item.priceCents) && item.priceCents >= 0
          ? formatMoney(item.priceCents, text(item.currency, 8))
          : "",
      availability: text(item.availability, 40).replace(/_/g, " "),
      image: img(item.imageUrl, item.title, "product-image"),
      href: safeHref(item.externalUrl, ctx.basePath),
    }))
    .filter((item) => item.title);
  if (!products.length) return "";
  const columns = typeof p.columns === "number" && Number.isFinite(p.columns) ? Math.min(Math.max(Math.round(p.columns), 1), 4) : 3;
  return `<section class="block products">${sectionHeading(p)}<ul class="product-list cols-${columns}" role="list">${products
    .map(
      (item) =>
        `<li class="product">${item.image}<h3>${escapeHtml(item.title)}</h3>${
          item.price || item.availability
            ? `<p class="product-meta">${item.price ? `<span class="price">${escapeHtml(item.price)}</span>` : ""}${
                item.availability ? `<span class="availability">${escapeHtml(item.availability)}</span>` : ""
              }</p>`
            : ""
        }${item.href ? `<p><a class="button button-secondary" ${linkAttrs(item.href)}>View product<span class="visually-hidden">: ${escapeHtml(item.title)}</span></a></p>` : ""}</li>`,
    )
    .join("")}</ul></section>`;
}

function renderBlock(block: unknown, ctx: RenderContext): string {
  const b = record(block);
  const type = typeof b.type === "string" ? b.type : "";
  const p = record(b.props);
  switch (type) {
    case "hero":
      return renderHero(p, ctx);
    case "richText":
      return renderRichText(p, ctx);
    case "image":
      return renderImage(p);
    case "quote":
      return renderQuote(p);
    case "cta":
      return renderCta(p, ctx);
    case "featureGrid":
      return renderFeatureGrid(p);
    case "faq":
      return renderFaq(p);
    case "stats":
      return renderStats(p);
    case "divider":
      return `<hr class="block divider">`;
    case "spacer":
      return renderSpacer(p);
    case "productGrid":
      return renderProductGrid(p, ctx);
    default:
      return "";
  }
}

/* ── Document ───────────────────────────────────────────────────────────── */

const STYLE = `
:root{color-scheme:light dark;--bg:oklch(99% 0.003 250);--surface:oklch(97% 0.006 250);--surface-2:oklch(94.5% 0.009 250);--text:oklch(22% 0.02 260);--muted:oklch(46% 0.02 260);--border:oklch(90% 0.01 250);--accent:oklch(50% 0.17 262);--accent-text:oklch(99% 0 0);--accent-soft:oklch(95% 0.03 262);--focus:oklch(55% 0.2 262);--radius:14px;--shadow:0 1px 2px oklch(20% 0.02 260 / .06),0 8px 24px oklch(20% 0.02 260 / .06);--max:72rem;--font:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
@media (prefers-color-scheme:dark){:root{--bg:oklch(17% 0.015 260);--surface:oklch(21% 0.017 260);--surface-2:oklch(25% 0.02 260);--text:oklch(95% 0.008 250);--muted:oklch(75% 0.015 250);--border:oklch(32% 0.02 260);--accent:oklch(74% 0.13 262);--accent-text:oklch(18% 0.03 262);--accent-soft:oklch(28% 0.05 262);--focus:oklch(80% 0.13 262);--shadow:0 1px 2px oklch(0% 0 0 / .3),0 8px 24px oklch(0% 0 0 / .25)}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--font);font-size:1.0625rem;line-height:1.65;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;min-height:100vh}
img{max-width:100%;height:auto;display:block}
a{color:var(--accent);text-underline-offset:.2em}
a:hover{text-decoration-thickness:2px}
:focus-visible{outline:3px solid var(--focus);outline-offset:3px;border-radius:4px}
h1,h2,h3,h4{line-height:1.2;letter-spacing:-.015em;margin:0 0 .5em;text-wrap:balance}
h1{font-size:clamp(2.2rem,5vw,3.6rem);letter-spacing:-.03em}
h2{font-size:clamp(1.6rem,3vw,2.2rem)}
h3{font-size:1.2rem}
h4{font-size:1.05rem}
p{margin:0 0 1em}
.visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.skip-link{position:absolute;left:1rem;top:-4rem;z-index:10;background:var(--accent);color:var(--accent-text);padding:.6rem 1rem;border-radius:8px;font-weight:600;text-decoration:none}
.skip-link:focus{top:1rem}
.container{width:100%;max-width:var(--max);margin:0 auto;padding:0 1.25rem}
.site-header{position:sticky;top:0;z-index:5;background:color-mix(in oklch,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--border)}
.site-header .container{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem 1.5rem;padding-top:.85rem;padding-bottom:.85rem}
.brand{font-weight:700;font-size:1.1rem;color:var(--text);text-decoration:none;letter-spacing:-.01em}
.site-nav ul{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:.25rem}
.site-nav a{display:inline-block;padding:.4rem .75rem;border-radius:999px;color:var(--muted);text-decoration:none;font-size:.95rem;font-weight:500}
.site-nav a:hover{color:var(--text);background:var(--surface-2)}
.site-nav a[aria-current="page"]{color:var(--text);background:var(--surface-2)}
main{flex:1;padding:2.5rem 0 4rem}
main .container{display:flex;flex-direction:column;gap:3.5rem}
.page-header h1{margin:0}
.block{margin:0}
.hero{display:grid;gap:2.5rem;align-items:center;padding:2rem 0}
.hero-copy{max-width:44rem}
.hero-center{text-align:center;justify-items:center}
.hero-center .hero-copy{margin:0 auto}
@media (min-width:56rem){.hero-with-image{grid-template-columns:1.1fr 1fr}.hero-center.hero-with-image{grid-template-columns:1fr}}
.hero-image{width:100%;border-radius:calc(var(--radius) + 4px);box-shadow:var(--shadow);object-fit:cover;aspect-ratio:4/3}
.eyebrow{display:inline-block;font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.12em;color:var(--accent);background:var(--accent-soft);padding:.3rem .7rem;border-radius:999px;margin-bottom:1rem}
.lead{font-size:clamp(1.1rem,2vw,1.3rem);color:var(--muted);max-width:40rem}
.hero-center .lead{margin-left:auto;margin-right:auto}
.actions{margin:1.5rem 0 0;display:flex;flex-wrap:wrap;gap:.75rem}
.hero-center .actions{justify-content:center}
.button{display:inline-flex;align-items:center;justify-content:center;min-height:2.75rem;padding:.7rem 1.35rem;border-radius:999px;font-weight:600;text-decoration:none;transition:transform .15s ease,background-color .15s ease}
.button-primary{background:var(--accent);color:var(--accent-text)}
.button-primary:hover{transform:translateY(-1px)}
.button-secondary{background:var(--surface-2);color:var(--text);border:1px solid var(--border)}
@media (prefers-reduced-motion:reduce){.button{transition:none}.button-primary:hover{transform:none}}
.prose{max-width:44rem}
.prose ul,.prose ol{padding-left:1.4em;margin:0 0 1em}
.prose li{margin:.25em 0}
.prose blockquote{margin:1.5em 0;padding:.25em 0 .25em 1.2em;border-left:3px solid var(--accent);color:var(--muted)}
.prose code{font-family:var(--mono);font-size:.9em;background:var(--surface-2);padding:.15em .4em;border-radius:6px}
.prose h2,.prose h3,.prose h4{margin-top:1.4em}
.figure{margin:0}
.figure-image{width:100%;border-radius:var(--radius);box-shadow:var(--shadow)}
figcaption{margin-top:.75rem;font-size:.9rem;color:var(--muted)}
.quote{margin:0;padding:2rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);max-width:48rem}
.quote blockquote{margin:0}
.quote blockquote p{font-size:clamp(1.2rem,2.4vw,1.5rem);line-height:1.45;font-weight:500;margin:0}
.quote figcaption::before{content:"\\2014\\00a0"}
.cta{padding:clamp(2rem,5vw,3.5rem);border-radius:calc(var(--radius) + 6px);background:var(--accent-soft);border:1px solid var(--border);text-align:center}
.cta p{color:var(--muted);max-width:38rem;margin-left:auto;margin-right:auto}
.cta .actions{justify-content:center}
.section-title{margin-bottom:1.5rem}
.feature-list,.product-list{list-style:none;margin:0;padding:0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))}
.feature,.product{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.5rem}
.feature p{color:var(--muted);margin:0}
.product{display:flex;flex-direction:column;gap:.5rem}
.product h3{margin:0}
.product-image{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:calc(var(--radius) - 4px);margin-bottom:.5rem}
.product-meta{display:flex;flex-wrap:wrap;gap:.75rem;margin:0;color:var(--muted);font-size:.95rem}
.price{color:var(--text);font-weight:600}
.product .button{margin-top:.25rem}
@media (min-width:56rem){.product-list.cols-1{grid-template-columns:1fr}.product-list.cols-2{grid-template-columns:repeat(2,1fr)}.product-list.cols-3{grid-template-columns:repeat(3,1fr)}.product-list.cols-4{grid-template-columns:repeat(4,1fr)}}
.faq-list{display:grid;gap:.75rem;max-width:48rem}
.faq-item{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:0 1.25rem}
.faq-item summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 0}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item summary::after{content:"+";font-size:1.4rem;line-height:1;color:var(--muted)}
.faq-item[open] summary::after{content:"\\2212"}
.faq-item summary h3{margin:0;font-size:1.05rem}
.faq-item p{color:var(--muted);margin:0 0 1.1rem}
.stat-list{margin:0;display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr))}
.stat{display:flex;flex-direction:column-reverse;gap:.25rem;padding:1.5rem;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);text-align:center}
.stat dd{margin:0;font-size:clamp(1.8rem,4vw,2.6rem);font-weight:700;letter-spacing:-.02em;color:var(--accent)}
.stat dt{color:var(--muted);font-size:.95rem}
.divider{border:0;border-top:1px solid var(--border);width:100%}
.not-found{text-align:center;padding:4rem 0}
.not-found p{color:var(--muted)}
.not-found .actions{justify-content:center}
.site-footer{border-top:1px solid var(--border);padding:1.75rem 0;font-size:.9rem;color:var(--muted)}
.site-footer .container{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem 1.5rem}
.site-footer p{margin:0}
.site-footer a{color:var(--muted)}
`.trim();

function head(opts: {
  title: string;
  description: string;
  noindex: boolean;
  canonical: string | null;
  ogImage: string | null;
  siteName: string;
}): string {
  const parts = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(opts.title)}</title>`,
  ];
  if (opts.description) parts.push(`<meta name="description" content="${escapeHtml(opts.description)}">`);
  parts.push(`<meta name="robots" content="${opts.noindex ? "noindex, nofollow" : "index, follow"}">`);
  parts.push(`<meta name="referrer" content="strict-origin-when-cross-origin">`);
  if (opts.canonical) parts.push(`<link rel="canonical" href="${escapeHtml(opts.canonical)}">`);
  parts.push(`<meta property="og:type" content="website">`);
  parts.push(`<meta property="og:title" content="${escapeHtml(opts.title)}">`);
  if (opts.siteName) parts.push(`<meta property="og:site_name" content="${escapeHtml(opts.siteName)}">`);
  if (opts.description) parts.push(`<meta property="og:description" content="${escapeHtml(opts.description)}">`);
  if (opts.canonical) parts.push(`<meta property="og:url" content="${escapeHtml(opts.canonical)}">`);
  if (opts.ogImage) parts.push(`<meta property="og:image" content="${escapeHtml(opts.ogImage)}">`);
  parts.push(`<meta name="twitter:card" content="${opts.ogImage ? "summary_large_image" : "summary"}">`);
  parts.push(`<style>${STYLE}</style>`);
  return parts.join("\n");
}

function cleanBasePath(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim().replace(/\/+$/, "");
  // Only plain path characters; anything else falls back to the site root.
  return /^(?:\/[A-Za-z0-9._~-]+)*$/.test(trimmed) ? trimmed : "";
}

function samePath(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/[?#].*$/, "").replace(/\/+$/, "") || "/";
  return norm(a) === norm(b);
}

function header(siteName: string, basePath: string, nav: unknown, currentHref: string): string {
  const items = list(nav, 20)
    .map((item) => ({ title: text(item.title, 80), href: safeHref(item.href) }))
    .filter((item): item is { title: string; href: string } => Boolean(item.title && item.href));
  const navHtml = items.length
    ? `<nav class="site-nav" aria-label="Main"><ul>${items
        .map(
          (item) =>
            `<li><a ${linkAttrs(item.href)}${samePath(item.href, currentHref) ? ` aria-current="page"` : ""}>${escapeHtml(item.title)}</a></li>`,
        )
        .join("")}</ul></nav>`
    : "";
  return `<header class="site-header"><div class="container"><a class="brand" href="${escapeHtml(`${basePath}/`)}">${escapeHtml(siteName)}</a>${navHtml}</div></header>`;
}

function footer(siteName: string): string {
  const year = new Date().getUTCFullYear();
  return `<footer class="site-footer"><div class="container"><p>&copy; ${year} ${escapeHtml(siteName)}</p><p>Built with <a href="${MOSAI_HOME_URL}" rel="noopener">MOSAI</a></p></div></footer>`;
}

function htmlDocument(headHtml: string, bodyHtml: string): string {
  return `<!doctype html>\n<html lang="en">\n<head>\n${headHtml}\n</head>\n<body>\n<a class="skip-link" href="#main">Skip to content</a>\n${bodyHtml}\n</body>\n</html>\n`;
}

/** Render one published page as a complete, script-free HTML document. */
export function renderSitePage(input: RenderSitePageInput): string {
  const src = record(input);
  const siteName = text(src.siteName, 120) || "Website";
  const basePath = cleanBasePath(src.basePath);
  const page = record(src.page);
  const seo = record(page.seo);
  const pageTitle = text(page.title, 200);
  const fullPath = typeof page.fullPath === "string" && page.fullPath.startsWith("/") ? page.fullPath : "/";
  const currentHref = fullPath === "/" ? `${basePath}/` : `${basePath}${fullPath}`;

  const seoTitle = text(seo.title, 200);
  const title =
    seoTitle ||
    (pageTitle && pageTitle.toLowerCase() !== siteName.toLowerCase() ? `${pageTitle} · ${siteName}` : siteName);

  const ctx: RenderContext = { basePath, h1Used: false };
  const blocks = Array.isArray(page.blocks) ? page.blocks.slice(0, 500) : [];
  // The page's one h1: the first hero heading if the page has one, else the title.
  const heroHasHeading = blocks.some((b) => {
    const r = record(b);
    return r.type === "hero" && text(record(r.props).heading, 300) !== "";
  });
  let pageHeader = "";
  if (!heroHasHeading) {
    pageHeader = `<header class="page-header"><h1>${escapeHtml(pageTitle || siteName)}</h1></header>`;
    ctx.h1Used = true;
  }
  const blockHtml: string[] = [];
  for (const block of blocks) {
    try {
      const html = renderBlock(block, ctx);
      if (html) blockHtml.push(html);
    } catch {
      // A malformed block never takes the page down.
    }
  }

  const headHtml = head({
    title,
    description: text(seo.metaDescription, 320),
    noindex: seo.noindex === true,
    canonical: safeHttpUrl(src.canonicalUrl),
    ogImage: ogImageUrl(seo.ogImageUrl),
    siteName,
  });
  const body = `${header(siteName, basePath, src.nav, currentHref)}\n<main id="main" tabindex="-1"><div class="container">${pageHeader}${blockHtml.join("\n")}</div></main>\n${footer(siteName)}`;
  return htmlDocument(headHtml, body);
}

/** A script-free 404 page (always noindex). */
export function renderNotFoundPage(input?: { siteName?: string; basePath?: string }): string {
  const src = record(input);
  const siteName = text(src.siteName, 120);
  const basePath = cleanBasePath(src.basePath);
  const home = `${basePath}/`;
  const headHtml = head({
    title: siteName ? `Page not found · ${siteName}` : "Page not found",
    description: "",
    noindex: true,
    canonical: null,
    ogImage: null,
    siteName,
  });
  const top = siteName ? header(siteName, basePath, [], "") : "";
  const body = `${top}\n<main id="main" tabindex="-1"><div class="container"><section class="not-found"><h1>Page not found</h1><p>The page you were looking for doesn&#39;t exist or has moved.</p><p class="actions"><a class="button button-primary" href="${escapeHtml(home)}">Go to the home page</a></p></section></div></main>\n${footer(siteName || "MOSAI")}`;
  return htmlDocument(headHtml, body);
}
