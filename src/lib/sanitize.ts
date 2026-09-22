import DOMPurify from "dompurify";

/**
 * Single sanitizer for every `dangerouslySetInnerHTML` sink that renders
 * user- or AI-authored rich text (review finding T0.7: stored XSS).
 *
 * The block CMS stores rich text as an HTML string, and page drafts / public
 * pages render on the app's own origin — so unsanitized HTML was a stored-XSS
 * vector. Always pass such HTML through here before injecting it.
 *
 * Policy: an explicit allow-list of prose tags/attributes, implemented as an
 * isomorphic **rebuild** core (`allowListSanitize`) plus — wherever a real DOM
 * exists — a DOMPurify pass with the SAME lists. Two properties matter:
 *
 *  - The core needs no DOM, so the same policy runs inside Convex on SAVE
 *    (`sanitizeDocument` via `lib/cms/blocks.ts`, ticket T0.7 remainder),
 *    not only at render time. DOMPurify requires a window, which the server
 *    does not have.
 *  - The core never passes input through: allowed tags are re-emitted from
 *    the list above, attributes are re-emitted from ALLOWED_ATTR after
 *    decoding + validating `href`, and any `<` construct it cannot vouch for
 *    is escaped to text. Scripts, event handlers, styles, iframes, forms and
 *    objects are never allowed; `javascript:` / `data:` URLs are refused
 *    (entity- and control-character-encoded schemes included).
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

const ALLOWED_TAG_SET: ReadonlySet<string> = new Set<string>(ALLOWED_TAGS);
const ALLOWED_ATTR_SET: ReadonlySet<string> = new Set<string>(ALLOWED_ATTR);

/** Elements whose CONTENT is dropped with the element itself — never left in
 *  the output as visible text (matches DOMPurify's behaviour for these). */
const DROP_CONTENT_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "textarea",
  "title",
  "svg",
  "math",
  "canvas",
  "applet",
  "frame",
  "frameset",
]);

/** The subset of HTML named entities that can change how an attribute value
 *  parses (`&colon;` → `:`, `&#58;` → `:` are the classic javascript: bypass). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
    quot: '"',
  apos: "'",
  colon: ":",
  sol: "/",
  tab: "\t",
  newline: "\n",
  nbsp: "\u00a0",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (full, body: string) => {
      if (body.startsWith("#")) {
        const code = body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return full;
        try {
          return String.fromCodePoint(code);
        } catch {
          return full;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? full;
    },
  );
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Validate a link target after decoding. Returns the value to emit, or null
 * when the URL scheme is not navigable-safe.
 *
 * The scheme check runs on a copy with ASCII whitespace/control characters
 * removed — browsers strip tabs/newlines inside URLs when parsing, so
 * `java\tscript:` must be judged as `javascript:`. We remove MORE characters
 * than a browser does (spaces too), which can only produce false rejections,
 * never a false acceptance.
 */
function safeHref(raw: string): string | null {
  const decoded = decodeEntities(raw);
  const compact = decoded.replace(/[\u0000-\u0020\u007f]/g, "");
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (name !== "https" && name !== "http" && name !== "mailto" && name !== "tel") {
      return null;
    }
  }
  return decoded;
}

const TAG_RE =
  /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/;
const ATTR_RE =
  /([a-zA-Z-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

function unquote(value: string): string {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
    return value.slice(1, -1);
  }
  return value;
}

function rebuildAttributes(rawAttrs: string): string {
  let out = "";
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(rawAttrs)) !== null) {
    const name = match[1].toLowerCase();
    if (!ALLOWED_ATTR_SET.has(name)) continue; // on*, style, class, … dropped
    if (match[2] === undefined) continue; // value-less attributes carry no meaning here
    const decoded = unquote(match[2]);
    let value: string;
    if (name === "href") {
      const checked = safeHref(decoded);
      if (checked === null) continue; // javascript:/data:/vbscript: … dropped
      value = checked;
    } else if (name === "target") {
      value = decodeEntities(decoded);
      if (!/^_(blank|self|parent|top)$/.test(value)) continue;
    } else if (name === "rel") {
      value = decodeEntities(decoded);
      if (!/^[a-zA-Z-]+$/.test(value)) continue;
    } else {
      value = decodeEntities(decoded); // title — re-escaped on emit
    }
    out += ` ${name}="${escapeAttribute(value)}"`;
  }
  return out;
}

/**
 * The isomorphic allow-list core. Rebuilds only allow-listed markup; escapes
 * any `<` it cannot vouch for; drops disallowed elements (and the content of
 * script/style/iframe-like elements). Text is copied through unchanged —
 * without a `<` it cannot start markup, and entity-encoded `&lt;` is never
 * re-tokenized by the HTML parser.
 */
export function allowListSanitize(input: string): string {
  let out = "";
  let i = 0;
  const n = input.length;

  while (i < n) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, lt);

    // Comments / doctype / processing instructions: dropped whole.
    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (input.startsWith("<!", lt) || input.startsWith("<?", lt)) {
      const end = input.indexOf(">", lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const tagMatch = TAG_RE.exec(input.slice(lt));
    if (!tagMatch) {
      out += "&lt;"; // a `<` we cannot parse never becomes markup
      i = lt + 1;
      continue;
    }

    const [full, closing, rawName, rawAttrs, selfClosing] = tagMatch;
    const name = rawName.toLowerCase();

    if (!ALLOWED_TAG_SET.has(name)) {
      if (!closing && !selfClosing && DROP_CONTENT_TAGS.has(name)) {
        // Drop the element AND its content (script bodies must not surface as
        // visible text, and their insides must never be re-parsed).
        const rest = input.slice(lt + full.length);
        const closeRe = new RegExp(`<\\/${name}\\s*>`, "i");
        const close = closeRe.exec(rest);
        i = close ? lt + full.length + close.index + close[0].length : n;
      } else {
        i = lt + full.length; // drop the markup, keep surrounding text
      }
      continue;
    }

    if (closing) {
      out += `</${name}>`;
    } else {
      out += `<${name}${rebuildAttributes(rawAttrs)}>`;
      // A self-closing slash on a non-void allowed tag is simply not re-emitted.
      void selfClosing;
    }
    i = lt + full.length;
  }
  return out;
}

/**
 * The one entry point. Always runs the isomorphic core; in a browser it also
 * runs DOMPurify (with the same lists) on top, so the rendered result passes
 * through a battle-tested parser where one exists — and the server, where one
 * does not, still enforces byte-for-byte the same policy on save.
 */
export function sanitizeHtml(html: unknown): string {
  if (typeof html !== "string" || html.length === 0) return "";
  const core = allowListSanitize(html);
  const domAvailable =
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    DOMPurify.isSupported === true;
  if (!domAvailable) return core;
  try {
    return DOMPurify.sanitize(core, {
      ALLOWED_TAGS: [...ALLOWED_TAGS],
      ALLOWED_ATTR: [...ALLOWED_ATTR],
    });
  } catch {
    return core;
  }
}
