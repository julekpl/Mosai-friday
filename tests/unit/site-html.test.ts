// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PUBLIC_SITE_CSP,
  renderNotFoundPage,
  renderSitePage,
  safeHref,
  sanitizeRichText,
  type RenderSitePageInput,
  type SiteBlock,
} from "@/convex/lib/siteHtml";
import { BLOCK_REGISTRY } from "@/lib/cms/blocks";

/**
 * Public site renderer. Customer sites are served as static HTML from the
 * dashboard origin, so the rendered document must never be able to run
 * script, whatever the stored block props contain.
 */

const BASE = "/s/acme-website";

function page(blocks: SiteBlock[], overrides: Partial<RenderSitePageInput> = {}): string {
  return renderSitePage({
    siteName: "Acme Bakery",
    basePath: BASE,
    page: { title: "Home", fullPath: "/", blocks },
    nav: [
      { title: "Home", href: `${BASE}/` },
      { title: "About", href: `${BASE}/about` },
    ],
    ...overrides,
  });
}

function block(type: string, props: unknown, id = `blk_${type}`): SiteBlock {
  return { id, type, version: 1, props };
}

/** Every real tag in the document (escaped text never contains a raw "<"). */
function tags(html: string): string[] {
  return html.match(/<[^>]*>/g) ?? [];
}

const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

function assertNoForbiddenOutput(html: string) {
  expect(html).not.toMatch(/<\s*script/i);
  expect(html).not.toMatch(/<\s*\/\s*script/i);
  expect(html).not.toMatch(/<\s*iframe/i);
  expect(html).not.toMatch(/<\s*object/i);
  expect(html).not.toMatch(/<\s*embed/i);
  expect(html).not.toMatch(/<\s*form/i);
  expect(html).not.toMatch(/<\s*base[\s>/]/i);
  expect(html).not.toMatch(/<\s*svg/i);
  expect(html).not.toMatch(/<\s*img[^>]*\sonerror/i);
  expect(html).not.toMatch(/<meta(?:\s[a-z:-]+="[^"]*")*\s+http-equiv/i);
  // exactly one <style> element: ours, in the head
  expect(html.match(/<style[\s>]/gi)?.length).toBe(1);
  for (const tag of tags(html)) {
    if (tag === "<!doctype html>") continue;
    // The renderer always emits double-quoted, escaped attribute values, so
    // this reads every attribute exactly; anything left over is a defect.
    const body = tag.replace(/^<\/?[a-z0-9]+/i, "").replace(/\/?>$/, "");
    const attrs = [...body.matchAll(/\s([a-z][a-z0-9:-]*)(?:="([^"<>]*)")?/gi)];
    expect(body.replace(/\s([a-z][a-z0-9:-]*)(?:="([^"<>]*)")?/gi, "").trim(), tag).toBe("");
    for (const [, rawName, value = ""] of attrs) {
      const name = rawName.toLowerCase();
      expect(name, tag).not.toMatch(/^on|^srcdoc$|^formaction$|^xlink:href$|^http-equiv$|^action$/);
      if (name === "href") expect(value, tag).toMatch(SAFE_HREF);
      if (name === "src") {
        expect(value, tag).toMatch(/^(?:https:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i);
      }
      if (name === "style") expect(value, tag).toMatch(/^height:\d+px$/);
      if (name === "href" || name === "src") {
        expect(value, tag).not.toMatch(/javascript|vbscript|data:text/i);
      }
    }
  }
}

const SAMPLE_PROPS: Record<string, Record<string, unknown>> = {
  hero: {
    eyebrow: "Fresh daily",
    heading: "Bread worth waking up for",
    body: "Sourdough baked every morning.",
    imageUrl: "https://cdn.example.com/hero.jpg",
    imageAlt: "A loaf of sourdough",
    ctaLabel: "Order now",
    ctaHref: "/order",
    align: "center",
  },
  richText: { html: "<h2>Our story</h2><p>We <strong>love</strong> <em>bread</em>.</p><ul><li>Rye</li></ul>" },
  image: { assetId: "a1", assetUrl: "https://cdn.example.com/shop.jpg", alt: "The shop front", caption: "Main street" },
  quote: { text: "Best croissant in town.", attribution: "Local Times" },
  cta: { heading: "Visit us", body: "Open 7 to 3.", buttonLabel: "Get directions", buttonHref: "https://maps.example.com/acme" },
  featureGrid: { heading: "Why Acme", items: [{ title: "Organic flour", body: "Stone milled." }, { title: "Slow proof" }] },
  faq: { heading: "Questions", items: [{ question: "Do you deliver?", answer: "Within 5 km." }] },
  stats: { items: [{ value: "12", label: "Years baking" }] },
  divider: {},
  spacer: { height: 64 },
  productGrid: {
    collectionId: "c1",
    columns: 2,
    resolvedProducts: [
      {
        title: "Country loaf",
        priceCents: 650,
        currency: "EUR",
        availability: "in_stock",
        imageUrl: "https://cdn.example.com/loaf.jpg",
        externalUrl: "https://shop.example.com/loaf",
      },
    ],
  },
};

const EXPECTED: Record<string, (html: string) => void> = {
  hero: (html) => {
    expect(html).toContain(`<h1 class="hero-title">Bread worth waking up for</h1>`);
    expect(html).toContain(`<p class="eyebrow">Fresh daily</p>`);
    expect(html).toContain(`<a class="button button-primary" href="${BASE}/order">Order now</a>`);
    expect(html).toContain(`alt="A loaf of sourdough"`);
    expect(html).toContain("hero-center");
  },
  richText: (html) => {
    expect(html).toContain("<h2>Our story</h2><p>We <strong>love</strong> <em>bread</em>.</p><ul><li>Rye</li></ul>");
  },
  image: (html) => {
    expect(html).toMatch(/<figure class="block figure"><img[^>]*src="https:\/\/cdn\.example\.com\/shop\.jpg"[^>]*alt="The shop front"/);
    expect(html).toContain("<figcaption>Main street</figcaption>");
  },
  quote: (html) => {
    expect(html).toContain("<blockquote><p>Best croissant in town.</p></blockquote><figcaption>Local Times</figcaption>");
  },
  cta: (html) => {
    expect(html).toContain("<h2>Visit us</h2>");
    expect(html).toContain(`<a class="button button-primary" href="https://maps.example.com/acme" rel="noopener">Get directions</a>`);
  },
  featureGrid: (html) => {
    expect(html).toContain(`<h2 class="section-title">Why Acme</h2>`);
    expect(html).toContain("<h3>Organic flour</h3><p>Stone milled.</p>");
    expect(html).toContain("<h3>Slow proof</h3>");
  },
  faq: (html) => {
    expect(html).toContain("<details class=\"faq-item\"><summary><h3>Do you deliver?</h3></summary><p>Within 5 km.</p></details>");
  },
  stats: (html) => {
    expect(html).toContain("<dt>Years baking</dt><dd>12</dd>");
  },
  divider: (html) => {
    expect(html).toContain(`<hr class="block divider">`);
  },
  spacer: (html) => {
    expect(html).toContain(`style="height:64px" aria-hidden="true"`);
  },
  productGrid: (html) => {
    expect(html).toContain("<h3>Country loaf</h3>");
    expect(html).toMatch(/6\.50/);
    expect(html).toContain("in stock");
    expect(html).toContain(`href="https://shop.example.com/loaf" rel="noopener"`);
    expect(html).toContain("cols-2");
  },
};

describe("renderSitePage — every registry block renders", () => {
  it("has a sample for every block type in BLOCK_REGISTRY", () => {
    expect(Object.keys(SAMPLE_PROPS).sort()).toEqual(BLOCK_REGISTRY.map((d) => d.type).sort());
  });

  for (const def of BLOCK_REGISTRY) {
    it(`renders ${def.type}`, () => {
      const html = page([block(def.type, SAMPLE_PROPS[def.type])]);
      EXPECTED[def.type](html);
      assertNoForbiddenOutput(html);
    });
  }

  it("renders all blocks together as one valid, safe document", () => {
    const html = page(BLOCK_REGISTRY.map((d) => block(d.type, SAMPLE_PROPS[d.type])));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(`<html lang="en">`);
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    assertNoForbiddenOutput(html);
  });

  it("does not render a productGrid without resolved products (no fake data)", () => {
    const html = page([block("productGrid", { collectionId: "c1", columns: 3 })]);
    expect(html).not.toContain("block products");
  });

  it("skips unknown block types silently", () => {
    const html = page([block("marquee", { text: "hello" }), block("quote", { text: "kept" })]);
    expect(html).not.toContain("hello");
    expect(html).not.toMatch(/unknown/i);
    expect(html).toContain("kept");
  });
});

describe("document structure and accessibility", () => {
  it("has a skip link, landmarks, header with site name and nav, and a footer", () => {
    const html = page([block("quote", { text: "Hi" })]);
    expect(html).toContain(`<a class="skip-link" href="#main">Skip to content</a>`);
    expect(html).toContain(`<main id="main" tabindex="-1">`);
    expect(html).toContain(`<a class="brand" href="${BASE}/">Acme Bakery</a>`);
    expect(html).toContain(`<nav class="site-nav" aria-label="Main">`);
    expect(html).toMatch(/<footer class="site-footer">[\s\S]*Built with <a href="https:\/\/appmosai\.com\/" rel="noopener">MOSAI<\/a>/);
    expect(html).toContain(":focus-visible");
    expect(html).toContain("prefers-color-scheme:dark");
  });

  it("uses the page title as the h1 when there is no hero", () => {
    const html = page([block("quote", { text: "Hi" })], {
      page: { title: "About us", fullPath: "/about", blocks: [block("quote", { text: "Hi" })] },
    });
    expect(html).toContain(`<header class="page-header"><h1>About us</h1></header>`);
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  });

  it("demotes a second hero heading to h2", () => {
    const html = page([block("hero", { heading: "One" }), block("hero", { heading: "Two" })]);
    expect(html).toContain(`<h1 class="hero-title">One</h1>`);
    expect(html).toContain(`<h2 class="hero-title">Two</h2>`);
  });

  it("emits alt text on images (empty alt when none is stored)", () => {
    const html = page([block("image", { assetUrl: "https://cdn.example.com/x.png" })]);
    expect(html).toMatch(/<img[^>]*alt=""/);
  });
});

describe("nav and basePath", () => {
  it("renders nav links as given and marks the current page", () => {
    const html = page([], {
      page: { title: "About", fullPath: "/about", blocks: [] },
    });
    expect(html).toContain(`<a href="${BASE}/about" aria-current="page">About</a>`);
    expect(html).toContain(`<a href="${BASE}/">Home</a>`);
  });

  it("marks home as current on the homepage", () => {
    expect(page([])).toContain(`<a href="${BASE}/" aria-current="page">Home</a>`);
  });

  it("drops nav items with unsafe hrefs", () => {
    const html = page([], { nav: [{ title: "Evil", href: "javascript:alert(1)" }, { title: "Ok", href: `${BASE}/ok` }] });
    expect(html).not.toContain("Evil");
    expect(html).toContain(`<a href="${BASE}/ok">Ok</a>`);
  });

  it("resolves site-relative block links under basePath", () => {
    expect(safeHref("/contact", BASE)).toBe(`${BASE}/contact`);
    expect(safeHref("/", BASE)).toBe(`${BASE}/`);
    expect(safeHref(`${BASE}/about`, BASE)).toBe(`${BASE}/about`);
    expect(safeHref("#pricing", BASE)).toBe("#pricing");
    expect(safeHref("mailto:hi@acme.test", BASE)).toBe("mailto:hi@acme.test");
    expect(safeHref("tel:+15551234", BASE)).toBe("tel:+15551234");
    expect(safeHref("https://acme.test/x", BASE)).toBe("https://acme.test/x");
    expect(safeHref("//evil.test", BASE)).toBeNull();
    expect(safeHref("contact", BASE)).toBeNull();
    const html = page([block("cta", { heading: "Go", buttonLabel: "Contact", buttonHref: "/contact" })]);
    expect(html).toContain(`href="${BASE}/contact"`);
  });

  it("resolves rich-text links under basePath with rel=noopener nofollow", () => {
    expect(sanitizeRichText(`<p><a href="/menu" target="_blank" class="x">Menu</a></p>`, BASE)).toBe(
      `<p><a href="${BASE}/menu" rel="noopener nofollow">Menu</a></p>`,
    );
  });

  it("ignores an unsafe basePath", () => {
    const html = page([], { basePath: `/s/x"><script>alert(1)</script>` });
    assertNoForbiddenOutput(html);
    expect(html).toContain(`<a class="brand" href="/">`);
  });
});

describe("SEO", () => {
  it("renders title, description, canonical and Open Graph tags", () => {
    const html = page([], {
      page: {
        title: "About",
        fullPath: "/about",
        seo: { title: "About Acme", metaDescription: "Family bakery since 2014", ogImageUrl: "https://cdn.example.com/og.png" },
        blocks: [],
      },
      canonicalUrl: "https://appmosai.com/s/acme-website/about",
    });
    expect(html).toContain("<title>About Acme</title>");
    expect(html).toContain(`<meta name="description" content="Family bakery since 2014">`);
    expect(html).toContain(`<link rel="canonical" href="https://appmosai.com/s/acme-website/about">`);
    expect(html).toContain(`<meta property="og:title" content="About Acme">`);
    expect(html).toContain(`<meta property="og:description" content="Family bakery since 2014">`);
    expect(html).toContain(`<meta property="og:image" content="https://cdn.example.com/og.png">`);
    expect(html).toContain(`<meta name="robots" content="index, follow">`);
  });

  it("falls back to page title · site name", () => {
    const html = page([], { page: { title: "Menu", fullPath: "/menu", blocks: [] } });
    expect(html).toContain("<title>Menu · Acme Bakery</title>");
  });

  it("sets robots noindex when requested", () => {
    const html = page([], { page: { title: "Draft", fullPath: "/draft", seo: { noindex: true }, blocks: [] } });
    expect(html).toContain(`<meta name="robots" content="noindex, nofollow">`);
  });

  it("omits canonical and og:image when they are not safe URLs", () => {
    const html = page([], {
      page: { title: "X", fullPath: "/", seo: { ogImageUrl: "javascript:alert(1)" }, blocks: [] },
      canonicalUrl: "javascript:alert(1)",
    });
    expect(html).not.toContain(`rel="canonical"`);
    expect(html).not.toContain("og:image");
  });

  it("omits canonical when none is given", () => {
    expect(page([])).not.toContain(`rel="canonical"`);
  });
});

describe("XSS corpus never produces forbidden output", () => {
  const PAYLOADS = [
    `<script>alert(1)</script>`,
    `<SCRIPT SRC=https://evil.test/x.js></SCRIPT>`,
    `<img src=x onerror=alert(1)>`,
    `<img src="https://ok.test/a.png" onerror="alert(1)">`,
    `<svg onload=alert(1)>`,
    `<svg><script>alert(1)</script></svg>`,
    `<a href="javascript:alert(1)">x</a>`,
    `<a href="JaVaScRiPt:alert(1)">x</a>`,
    `<a href="jav&#x61;script:alert(1)">x</a>`,
    `<a href="jav&#x61script:alert(1)">x</a>`,
    `<a href="jav&#97;script:alert(1)">x</a>`,
    `<a href="javascript&colon;alert(1)">x</a>`,
    `<a href="java\tscript:alert(1)">x</a>`,
    `<a href=" \x01javascript:alert(1)">x</a>`,
    `<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>`,
    `<a href="vbscript:msgbox(1)">x</a>`,
    `<a href='javascript:alert(1)' onclick='alert(1)'>x</a>`,
    `<a href=javascript:alert(1)>x</a>`,
    `<scr<script>ipt>alert(1)</scr</script>ipt>`,
    `<<script>script>alert(1)<</script>/script>`,
    `<p style="width:expression(alert(1))">x</p>`,
    `<div style="background:url(javascript:alert(1))">x</div>`,
    `<style>body{background:url("javascript:alert(1)")}</style>`,
    `<iframe src="https://evil.test"></iframe>`,
    `<iframe srcdoc="<script>alert(1)</script>"></iframe>`,
    `<object data="https://evil.test/x.swf"></object>`,
    `<embed src="https://evil.test/x.swf">`,
    `<form action="https://evil.test"><input name=a><button formaction=javascript:alert(1)>go</button></form>`,
    `<meta http-equiv="refresh" content="0;url=javascript:alert(1)">`,
    `<base href="https://evil.test/">`,
    `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>`,
    `<!--><script>alert(1)</script>-->`,
    `<![CDATA[<script>alert(1)</script>]]>`,
    `<p title="</p><script>alert(1)</script>">x</p>`,
    `<a href="#" title='" onmouseover="alert(1)'>x</a>`,
    `<details open ontoggle=alert(1)>`,
    `<p>unclosed <strong>bold <em>and</p></blockquote></section></main><script>alert(1)</script>`,
    `<template><script>alert(1)</script></template>`,
    `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>`,
    `<a href="/\\evil.test">x</a>`,
    `"><script>alert(1)</script>`,
    `javascript:alert(1)`,
  ];

  for (const payload of PAYLOADS) {
    it(`is safe for ${JSON.stringify(payload).slice(0, 80)}`, () => {
      const blocks: SiteBlock[] = [
        block("richText", { html: payload }, "b1"),
        block("hero", { heading: payload, eyebrow: payload, body: payload, ctaLabel: payload, ctaHref: payload, imageUrl: payload, imageAlt: payload }, "b2"),
        block("cta", { heading: payload, body: payload, buttonLabel: "Go", buttonHref: payload }, "b3"),
        block("image", { assetUrl: payload, alt: payload, caption: payload }, "b4"),
        block("quote", { text: payload, attribution: payload }, "b5"),
        block("featureGrid", { heading: payload, items: [{ title: payload, body: payload }] }, "b6"),
        block("faq", { heading: payload, items: [{ question: payload, answer: payload }] }, "b7"),
        block("stats", { items: [{ value: payload, label: payload }] }, "b8"),
        block("spacer", { height: payload }, "b9"),
        block(
          "productGrid",
          { resolvedProducts: [{ title: payload, currency: payload, availability: payload, imageUrl: payload, externalUrl: payload }], columns: payload },
          "b10",
        ),
      ];
      const html = renderSitePage({
        siteName: payload,
        basePath: BASE,
        page: {
          title: payload,
          fullPath: "/",
          seo: { title: payload, metaDescription: payload, ogImageUrl: payload },
          blocks,
        },
        nav: [{ title: payload, href: payload }],
        canonicalUrl: payload,
      });
      assertNoForbiddenOutput(html);
      const rich = sanitizeRichText(payload, BASE);
      expect(rich).not.toMatch(/<(?!\/?(?:p|h2|h3|h4|ul|ol|li|strong|em|a|br|blockquote|code)\b)/i);
    });
  }

  it("keeps rich text balanced so it cannot close the surrounding markup", () => {
    expect(sanitizeRichText(`<p>unclosed <strong>bold <em>and</p></blockquote></section></main>`)).toBe(
      "<p>unclosed <strong>bold <em>and</em></strong></p>",
    );
  });

  it("drops script-like elements with their content and keeps other text", () => {
    expect(sanitizeRichText(`<p>hi</p><script>alert(1)</script><div>kept</div>`)).toBe("<p>hi</p>kept");
    expect(sanitizeRichText(`<scr<script>ipt>alert(1)</scr</script>ipt>`)).not.toMatch(/<script/i);
  });

  it("drops dangerous link targets but keeps the link text", () => {
    expect(sanitizeRichText(`<a href="jav&#x61;script:alert(1)">x</a>`)).toBe("<a>x</a>");
    expect(sanitizeRichText(`<a href="https://ok.test/?a=1&amp;b=2">x</a>`)).toBe(
      `<a href="https://ok.test/?a=1&amp;b=2" rel="noopener nofollow">x</a>`,
    );
  });

  it("escapes text and maps h1 to h2", () => {
    expect(sanitizeRichText(`<h1>Big &amp; bold</h1><p>1 &lt; 2 > 0</p>`)).toBe("<h2>Big &amp; bold</h2><p>1 &lt; 2 &gt; 0</p>");
  });

  it("escapes plain-text props", () => {
    const html = page([block("quote", { text: `<b onmouseover="x">"quoted"</b>` })]);
    expect(html).toContain("&lt;b onmouseover=&quot;x&quot;&gt;&quot;quoted&quot;&lt;/b&gt;");
  });

  it("accepts raster data: images but not svg or html data URLs", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(page([block("image", { assetUrl: png, alt: "dot" })])).toContain(`src="${png}"`);
    expect(page([block("image", { assetUrl: "data:image/svg+xml;base64,PHN2Zz4=", alt: "x" })])).not.toContain("<img class=\"figure-image\"");
    expect(page([block("image", { assetUrl: "http://insecure.test/x.png", alt: "x" })])).not.toContain("<img class=\"figure-image\"");
  });
});

describe("malformed props never throw", () => {
  const MALFORMED: unknown[] = [null, undefined, 42, "string", [], [1, 2], { items: "nope" }, { items: [null, 1, "x", [], { title: {} }] }, { heading: { toString: () => { throw new Error("boom"); } } }, { html: 123 }, { height: Infinity }, { height: -50 }, { height: "9999" }, { resolvedProducts: [{ title: "T", priceCents: -5 }] }, { columns: NaN }];

  for (const def of BLOCK_REGISTRY) {
    it(`${def.type} tolerates malformed props`, () => {
      for (const props of MALFORMED) {
        const html = page([block(def.type, props)]);
        assertNoForbiddenOutput(html);
      }
    });
  }

  it("tolerates malformed blocks and page input", () => {
    const bad = [null, 1, "x", { type: 5 }, { type: "hero" }, { type: "hero", props: null }] as unknown as SiteBlock[];
    expect(() => page(bad)).not.toThrow();
    const input = { siteName: null, basePath: 7, page: { title: {}, fullPath: null, blocks: "nope", seo: "x" }, nav: "nope" } as unknown as RenderSitePageInput;
    const html = renderSitePage(input);
    assertNoForbiddenOutput(html);
    expect(() => renderSitePage(null as unknown as RenderSitePageInput)).not.toThrow();
  });

  it("clamps spacer height", () => {
    expect(page([block("spacer", { height: 9999 })])).toContain("height:200px");
    expect(page([block("spacer", { height: -5 })])).toContain("height:0px");
    expect(page([block("spacer", {})])).toContain("height:48px");
  });
});

describe("not found page", () => {
  it("is a safe, noindex 404 with a link home", () => {
    const html = renderNotFoundPage({ siteName: "Acme Bakery", basePath: BASE });
    expect(html).toContain("<h1>Page not found</h1>");
    expect(html).toContain(`href="${BASE}/"`);
    expect(html).toContain(`<meta name="robots" content="noindex, nofollow">`);
    assertNoForbiddenOutput(html);
  });

  it("works without input", () => {
    const html = renderNotFoundPage();
    expect(html).toContain("<h1>Page not found</h1>");
    assertNoForbiddenOutput(html);
  });
});

describe("PUBLIC_SITE_CSP", () => {
  it("is the exact policy the host sends", () => {
    expect(PUBLIC_SITE_CSP).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });
});
