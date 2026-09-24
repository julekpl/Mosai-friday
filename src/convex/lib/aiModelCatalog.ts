/**
 * Pure helpers for the admin AI-model allow-list (no Convex imports).
 *
 * OpenRouter's public `GET /api/v1/models` returns `{ data: [...] }` where each
 * entry has `id`, `name`, `context_length` and `pricing.prompt` /
 * `pricing.completion` as USD-per-token decimal strings.
 */

/** Used until the operator configures any model (keeps a fresh deployment working). */
export const FALLBACK_MODEL_ID = "openai/gpt-4o-mini";

/** `provider/model[:variant]`, conservative charset, bounded length. */
export function isValidModelId(value: string): boolean {
  return value.length <= 120 && /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(value);
}

export type OpenRouterCatalogEntry = {
  modelId: string;
  name: string;
  contextLength?: number;
  promptUsdPerMillion?: number;
  completionUsdPerMillion?: number;
};

function perMillion(value: unknown): number | undefined {
  const perToken = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(perToken) || perToken < 0) return undefined;
  return Math.round(perToken * 1_000_000 * 1000) / 1000;
}

/** Bounded, validated, optionally filtered view of the catalog. */
export function parseOpenRouterCatalog(value: unknown, search?: string): OpenRouterCatalogEntry[] {
  const data =
    value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)
      ? ((value as { data: unknown[] }).data)
      : [];
  const needle = search?.trim().toLowerCase().slice(0, 80) ?? "";
  const out: OpenRouterCatalogEntry[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const modelId = typeof entry.id === "string" ? entry.id : "";
    if (!isValidModelId(modelId)) continue;
    const name = typeof entry.name === "string" ? entry.name.slice(0, 120) : modelId;
    if (needle && !modelId.toLowerCase().includes(needle) && !name.toLowerCase().includes(needle)) continue;
    const pricing = entry.pricing && typeof entry.pricing === "object" ? (entry.pricing as Record<string, unknown>) : {};
    out.push({
      modelId,
      name,
      contextLength:
        typeof entry.context_length === "number" && Number.isInteger(entry.context_length)
          ? entry.context_length
          : undefined,
      promptUsdPerMillion: perMillion(pricing.prompt),
      completionUsdPerMillion: perMillion(pricing.completion),
    });
    if (out.length >= 60) break;
  }
  return out;
}
