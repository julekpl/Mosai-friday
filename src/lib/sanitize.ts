import DOMPurify from "dompurify";

/**
 * Single sanitizer for every `dangerouslySetInnerHTML` sink that renders
 * user- or AI-authored rich text (review finding T0.7: stored XSS).
 *
 * The block CMS stores rich text as an HTML string, and page drafts / public
 * pages render on the app's own origin — so unsanitized HTML was a stored-XSS
 * vector. Always pass such HTML through here before injecting it.
 *
 * Policy: an explicit allow-list of prose tags/attributes. DOMPurify's default
 * URI handling additionally drops `javascript:` / `data:` URLs; `target` and
 * `rel` are permitted so links can be written safely. Scripts, event handlers,
 * styles, iframes, forms and objects are never allowed.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "hr",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "sub",
  "sup",
  "mark",
  "small",
  "blockquote",
  "code",
  "pre",
  "a",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
] as const;

const ALLOWED_ATTR = ["href", "target", "rel", "title"] as const;

export function sanitizeHtml(html: unknown): string {
  if (typeof html !== "string" || html.length === 0) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
  });
}
