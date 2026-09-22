// @vitest-environment node
import { describe, expect, it } from "vitest";
import { allowListSanitize, sanitizeHtml } from "@/lib/sanitize";
import { sanitizeDocument, type PageDocument } from "@/lib/cms/blocks";

/**
 * T0.7 regression suite — stored XSS via rich text.
 *
 * These run without a DOM (node environment), which exercises the isomorphic
 * allow-list core that ALSO runs inside Convex on save (`sanitizeDocument`).
 * The renderer layers DOMPurify with the same lists on top in the browser;
 * the e2e sink is proven by `tests/e2e/sanitized-html.spec.ts`.
 */

describe("allowListSanitize — strips what executes", () => {
  it("drops <script> elements together with their content", () => {
    expect(allowListSanitize('<p>hi</p><script>alert(1)</script>')).toBe("<p>hi</p>");
    expect(allowListSanitize('<SCRIPT src="https://evil.example/x.js"></SCRIPT>')).toBe("");
  });

  it("drops event-handler attributes but keeps safe attributes", () => {
    expect(allowListSanitize('<a href="/ok" onclick="alert(1)" title="t">x</a>')).toBe(
      '<a href="/ok" title="t">x</a>',
    );
    expect(allowListSanitize('<p onmouseover="steal()">y</p>')).toBe("<p>y</p>");
  });

  it("drops style and other non-allow-listed attributes", () => {
    expect(allowListSanitize('<span style="position:fixed">z</span>')).toBe("<span>z</span>");
  });

  it("refuses javascript: hrefs, including entity- and control-encoded schemes", () => {
    expect(allowListSanitize('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(allowListSanitize('<a href="java&#115;cript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(allowListSanitize('<a href="&#x6a;avascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(allowListSanitize('<a href="java\tscript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(allowListSanitize('<a href="JAVASCRIPT:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(allowListSanitize('<a href="&colon;alert(1)">x</a>')).toBe("<a>x</a>");
    expect(allowListSanitize('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>')).toBe("<a>x</a>");
    expect(allowListSanitize('<a href="vbscript:msgbox(1)">x</a>')).toBe("<a>x</a>");
  });

  it("keeps navigable links (relative, http(s), mailto, tel)", () => {
    expect(allowListSanitize('<a href="/pricing">p</a>')).toBe('<a href="/pricing">p</a>');
    expect(allowListSanitize('<a href="https://example.com">e</a>')).toBe(
      '<a href="https://example.com">e</a>',
    );
    expect(allowListSanitize('<a href="mailto:hi@example.com">m</a>')).toBe(
      '<a href="mailto:hi@example.com">m</a>',
    );
    expect(allowListSanitize('<a href="tel:+15551234567">t</a>')).toBe(
      '<a href="tel:+15551234567">t</a>',
    );
  });

  it("drops iframe/object/embed/svg/templates with their content", () => {
    expect(allowListSanitize('<iframe src="https://evil.example"></iframe>')).toBe("");
    expect(allowListSanitize('<object data="x.swf"></object>')).toBe("");
    expect(allowListSanitize('<embed src="x.swf">')).toBe("");
    expect(allowListSanitize("<svg><script>alert(1)</script></svg>")).toBe("");
    expect(allowListSanitize("<template><img src=x onerror=alert(1)></template>")).toBe("");
    expect(allowListSanitize("<math><mtext></mtext></math>")).toBe("");
  });

  it("drops comments and doctypes", () => {
    expect(allowListSanitize("a<!--[if IE]><script>alert(1)</script><![endif]-->b")).toBe("ab");
    expect(allowListSanitize("<!DOCTYPE html><p>x</p>")).toBe("<p>x</p>");
  });

  it("escapes a `<` it cannot parse instead of passing it through", () => {
    expect(allowListSanitize("1 < 2 and <notatag>")).toBe("1 &lt; 2 and &lt;notatag>");
  });

  it("keeps plain prose and safe inline markup intact", () => {
    const html = "<h2>Title</h2><p>Hello <strong>world</strong> — 4 &lt; 5.</p><ul><li>one</li></ul>";
    expect(allowListSanitize(html)).toBe(html);
  });

  it("validates target/rel values", () => {
    expect(allowListSanitize('<a href="/x" target="_blank" rel="noopener">x</a>')).toBe(
      '<a href="/x" target="_blank" rel="noopener">x</a>',
    );
    expect(allowListSanitize('<a href="/x" target="javascript:1">x</a>')).toBe(
      '<a href="/x">x</a>',
    );
    expect(allowListSanitize('<a href="/x" rel="&lt;script&gt;">x</a>')).toBe('<a href="/x">x</a>');
  });
});

describe("sanitizeHtml — the one entry point", () => {
  it("returns an empty string for non-string or empty input", () => {
    expect(sanitizeHtml(undefined)).toBe("");
    expect(sanitizeHtml(null)).toBe("");
    expect(sanitizeHtml(42 as unknown as string)).toBe("");
    expect(sanitizeHtml("")).toBe("");
  });

  it("sanitizes hostile input without a DOM", () => {
    expect(sanitizeHtml('<img src=x onerror="alert(1)"><p>ok</p>')).toBe("<p>ok</p>");
  });
});

describe("sanitizeDocument — T0.7 sanitize-on-save", () => {
  const hostile = '<p onclick="alert(1)">hi</p><script>steal()</script>';
  const doc: PageDocument = {
    schemaVersion: 1,
    blocks: [
      { id: "blk_1", type: "richText", version: 1, props: { html: hostile } },
      { id: "blk_2", type: "quote", version: 1, props: { text: "<b>not html field</b>" } },
    ],
  };

  it("cleans rich-text HTML props before they reach the database", () => {
    const saved = sanitizeDocument(doc);
    expect(saved.blocks[0].props.html).toBe("<p>hi</p>");
    // Never leaves script bodies behind as visible text either.
    expect(JSON.stringify(saved)).not.toContain("steal");
    expect(JSON.stringify(saved)).not.toContain("onclick");
  });

  it("leaves non-HTML props byte-for-byte alone (renderer escapes them)", () => {
    const saved = sanitizeDocument(doc);
    expect(saved.blocks[1].props.text).toBe("<b>not html field</b>");
  });

  it("is idempotent — saving an already-clean document changes nothing", () => {
    const once = sanitizeDocument(doc);
    expect(sanitizeDocument(once)).toEqual(once);
  });
});
