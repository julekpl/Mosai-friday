// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { safeLinkHref, sanitizeCmsHtml } from "./safety";

describe("sanitizeCmsHtml", () => {
  it("keeps the supported semantic formatting", () => {
    expect(sanitizeCmsHtml("<h2>Title</h2><p><strong>Safe</strong></p>"))
      .toBe("<h2>Title</h2><p><strong>Safe</strong></p>");
  });

  it("removes scripts, event handlers, unsafe URLs, and unsupported embeds", () => {
    const output = sanitizeCmsHtml(
      '<script>alert(1)</script><p onclick="alert(2)">Copy</p>' +
        '<a href="javascript:alert(3)">Bad</a><iframe src="https://bad.example"></iframe>',
    );

    expect(output).toBe("<p>Copy</p><a>Bad</a>");
  });
});

describe("safeLinkHref", () => {
  it.each(["/contact", "#pricing", "https://example.com", "mailto:hi@example.com", "tel:+31123"])(
    "accepts %s",
    (href) => expect(safeLinkHref(href)).toBe(href),
  );

  it.each(["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "\u0000https://x.test"])(
    "rejects %s",
    (href) => expect(safeLinkHref(href)).toBeNull(),
  );
});
