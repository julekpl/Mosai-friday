import DOMPurify from "dompurify";

const CMS_TAGS = [
  "p",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "br",
  "a",
  "blockquote",
] as const;

/**
 * CMS rich text is presentation input, never trusted markup. Keep the
 * allowlist intentionally small so generated content cannot introduce active
 * elements, event handlers, embedded documents, forms, or arbitrary styles.
 */
export function sanitizeCmsHtml(value: unknown): string {
  return DOMPurify.sanitize(String(value ?? ""), {
    ALLOWED_TAGS: [...CMS_TAGS],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}

/** Return a safe CTA destination or null when the value could execute code. */
export function safeLinkHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  const hasControlCharacter = [...href].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!href || hasControlCharacter) return null;

  try {
    const parsed = new URL(href, "https://mosai.invalid");
    if (!["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol)) {
      return null;
    }
    return href;
  } catch {
    return null;
  }
}
