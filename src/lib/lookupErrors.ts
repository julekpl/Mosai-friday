import { ConvexError } from "convex/values";

/**
 * LQ-1: the platform monthly ceiling and the per-user daily cap for paid
 * SerpApi calls (`convex/lib/providerUsage.ts`, `reserveSerpApiCall`) are
 * refused with `new ConvexError({ code: LOOKUP_RESTING_CODE, message })`,
 * never a plain `Error`. Convex redacts a plain `Error`'s message in
 * production, so the client cannot match on text; `ConvexError.data` always
 * reaches the client and is the only thing callers should match on.
 *
 * Shared between server (scraping.ts, contentSourceImport.ts) and client
 * (the wizard) so both sides agree on the one code, the same way
 * `lib/url.ts` is shared for website normalization.
 */
export const LOOKUP_RESTING_CODE = "lookup_resting";

/** True when `error` is the ConvexError thrown at the SerpApi ceiling or
 *  per-user daily cap. Pure and side-effect free so it is unit-tested
 *  directly, with no network and no rendering. */
export function isLookupResting(error: unknown): boolean {
  return error instanceof ConvexError && (error.data as { code?: unknown } | undefined)?.code === LOOKUP_RESTING_CODE;
}
