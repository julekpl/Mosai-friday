/** MD-1: server-side derivation of the media fields on `projectFiles`. */

export type MediaKind = "image" | "video" | "document" | "other";

/** The file kind from the MIME type the server stored. */
export function mediaKindFor(mimeType: string | undefined): MediaKind | undefined {
  if (!mimeType) return undefined;
  const type = mimeType.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type === "application/pdf" || type.startsWith("text/") || type.includes("document")) return "document";
  return "other";
}

/** The media fields a file write stores, derived from the stored MIME type. */
export function mediaFieldsFor(
  mimeType: string | undefined,
  authenticity: "owner_supplied" | "licensed_stock",
): { kind?: MediaKind; authenticity: "owner_supplied" | "licensed_stock" } {
  const kind = mediaKindFor(mimeType);
  return kind ? { kind, authenticity } : { authenticity };
}
