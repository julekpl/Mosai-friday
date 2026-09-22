/**
 * MOSAI CMS block registry (W1) — see CMS-BLOCK-REGISTRY.md.
 *
 * Shared by the Convex backend (save/publish validation) and the editor UI.
 * Blocks model semantic purpose, never raw HTML as truth. Commerce blocks
 * store IDs only — price/stock/availability resolve from Sell at render time.
 */

export type BlockFieldKind =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "assetRef"
  | "collectionRef"
  | "list";

export type BlockField = {
  key: string;
  label: string;
  kind: BlockFieldKind;
  required?: boolean;
  /** For list fields: the shape of each item. */
  itemFields?: { key: string; label: string; required?: boolean }[];
};

export type BlockDef = {
  type: string;
  version: number;
  label: string;
  /** Editor palette grouping. */
  group: "content" | "marketing" | "commerce";
  fields: BlockField[];
  defaults: Record<string, unknown>;
  /** True when the block stores only canonical IDs (never copied facts). */
  commerce?: boolean;
};

export const BLOCK_REGISTRY: BlockDef[] = [
  {
    type: "hero",
    version: 1,
    label: "Hero",
    group: "marketing",
    fields: [
      { key: "eyebrow", label: "Eyebrow", kind: "string" },
      { key: "heading", label: "Heading", kind: "string", required: true },
      { key: "body", label: "Body", kind: "text" },
      { key: "imageAssetId", label: "Image", kind: "assetRef" },
      { key: "ctaLabel", label: "Button label", kind: "string" },
      { key: "ctaHref", label: "Button link", kind: "string" },
    ],
    defaults: { heading: "Your headline here", align: "left" },
  },
  {
    type: "richText",
    version: 1,
    label: "Rich text",
    group: "content",
    fields: [{ key: "html", label: "Content", kind: "text", required: true }],
    defaults: { html: "<p>Write something…</p>" },
  },
  {
    type: "image",
    version: 1,
    label: "Image",
    group: "content",
    fields: [
      { key: "assetId", label: "Asset", kind: "assetRef", required: true },
      { key: "alt", label: "Alt text", kind: "string", required: true },
      { key: "caption", label: "Caption", kind: "string" },
    ],
    defaults: { alt: "" },
  },
  {
    type: "quote",
    version: 1,
    label: "Quote",
    group: "content",
    fields: [
      { key: "text", label: "Quote", kind: "text", required: true },
      { key: "attribution", label: "Attribution", kind: "string" },
    ],
    defaults: { text: "" },
  },
  {
    type: "cta",
    version: 1,
    label: "Call to action",
    group: "marketing",
    fields: [
      { key: "heading", label: "Heading", kind: "string", required: true },
      { key: "body", label: "Body", kind: "text" },
      { key: "buttonLabel", label: "Button label", kind: "string", required: true },
      { key: "buttonHref", label: "Button link", kind: "string", required: true },
    ],
    defaults: { heading: "Ready to get started?", buttonLabel: "Contact us", buttonHref: "/contact" },
  },
  {
    type: "featureGrid",
    version: 1,
    label: "Feature grid",
    group: "marketing",
    fields: [
      { key: "heading", label: "Heading", kind: "string" },
      {
        key: "items",
        label: "Features",
        kind: "list",
        itemFields: [
          { key: "title", label: "Title", required: true },
          { key: "body", label: "Description" },
        ],
      },
    ],
    defaults: { items: [{ title: "Feature one", body: "" }] },
  },
  {
    type: "faq",
    version: 1,
    label: "FAQ",
    group: "marketing",
    fields: [
      { key: "heading", label: "Heading", kind: "string" },
      {
        key: "items",
        label: "Questions",
        kind: "list",
        itemFields: [
          { key: "question", label: "Question", required: true },
          { key: "answer", label: "Answer", required: true },
        ],
      },
    ],
    defaults: { items: [{ question: "", answer: "" }] },
  },
  {
    type: "stats",
    version: 1,
    label: "Stats",
    group: "marketing",
    fields: [
      {
        key: "items",
        label: "Stats",
        kind: "list",
        itemFields: [
          { key: "value", label: "Value", required: true },
          { key: "label", label: "Label", required: true },
        ],
      },
    ],
    defaults: { items: [{ value: "", label: "" }] },
  },
  {
    type: "divider",
    version: 1,
    label: "Divider",
    group: "content",
    fields: [],
    defaults: {},
  },
  {
    type: "spacer",
    version: 1,
    label: "Spacer",
    group: "content",
    fields: [{ key: "height", label: "Height (px)", kind: "number" }],
    defaults: { height: 48 },
  },
  {
    type: "productGrid",
    version: 1,
    label: "Product grid",
    group: "commerce",
    commerce: true,
    fields: [
      {
        key: "collectionId",
        label: "Collection",
        kind: "collectionRef",
        required: true,
      },
      { key: "columns", label: "Columns (desktop)", kind: "number" },
    ],
    defaults: { columns: 3 },
  },
];

export function getBlockDef(type: string): BlockDef | undefined {
  return BLOCK_REGISTRY.find((b) => b.type === type);
}

/** Schema-level validation at save time (blueprint §159). */
import { sanitizeHtml } from "../sanitize";

export function validateBlock(b: {
  type: string;
  version: number;
  props: Record<string, unknown>;
}): string[] {
  const errors: string[] = [];
  const def = getBlockDef(b.type);
  if (!def) {
    errors.push(`Unknown block type "${b.type}"`);
    return errors;
  }
  if (b.version > def.version) {
    errors.push(`Block "${b.type}" version ${b.version} is newer than supported`);
  }
  for (const f of def.fields) {
    if (f.kind === "list") continue;
    const val = b.props[f.key];
    if (f.required && (val === undefined || val === null || val === "")) {
      errors.push(`${def.label}: "${f.label}" is required`);
    }
  }
  if (def.commerce) {
    // commerce blocks may never embed copied product facts
    const forbidden = Object.keys(b.props).filter((k) =>
      ["price", "stock", "availability", "products"].includes(k),
    );
    for (const k of forbidden) {
      errors.push(`${def.label}: "${k}" is a Sell-owned fact and cannot be stored here`);
    }
  }
  return errors;
}

/**
 * Sanitize-on-save (pack T0.7 remainder). The renderer already passes rich
 * text through `sanitizeHtml` before injecting it, but a stored-XSS defence
 * that only exists at render time leaves poisoned HTML in the database for
 * the next consumer (export, public runtime, an unpatched sink). Every block
 * property that holds an HTML string is therefore cleaned here — inside
 * `validateDocument`'s caller, before validation — using the same isomorphic
 * allow-list policy the renderer uses (`src/lib/sanitize.ts` needs no DOM, so
 * it runs inside Convex). Plain-text properties are left byte-for-byte alone.
 */
export function sanitizeDocument(doc: PageDocument): PageDocument {
  return {
    ...doc,
    blocks: doc.blocks.map((b) => {
      if (typeof b.props.html !== "string") return b;
      return { ...b, props: { ...b.props, html: sanitizeHtml(b.props.html) } };
    }),
  };
}

export function validateDocument(doc: {
  schemaVersion: number;
  blocks: { id: string; type: string; version: number; props: Record<string, unknown> }[];
}): string[] {
  const errors: string[] = [];
  if (doc.schemaVersion !== 1) errors.push(`Unsupported document schemaVersion ${doc.schemaVersion}`);
  const seen = new Set<string>();
  for (const b of doc.blocks) {
    if (!b.id) errors.push("Every block needs a stable id");
    else if (seen.has(b.id)) errors.push(`Duplicate block id "${b.id}"`);
    seen.add(b.id);
    errors.push(...validateBlock(b));
  }
  return errors;
}

export type PageDocument = {
  schemaVersion: number;
  blocks: { id: string; type: string; version: number; props: Record<string, unknown> }[];
};

export function emptyDocument(): PageDocument {
  return { schemaVersion: 1, blocks: [] };
}

export function newBlockId(): string {
  return `blk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}
