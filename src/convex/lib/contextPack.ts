import type { BigFive, BigFiveSource } from "../../shared/bigFive";

/** `provider_data`: numbers imported from a connected provider by a verified
 *  server sync. Labels inside it (queries, page paths) remain untrusted text. */
export type ContextTrust = "workspace_entry" | "untrusted_source_text" | "provider_data";

export type ContextEvidence = {
  ref: string;
  version: string;
  source: string;
  title: string;
  trust: ContextTrust;
  text: string;
  truncated?: boolean;
};

export type ContextPersona = {
  id: string;
  name: string;
  role?: string;
  goals?: string[];
  pains?: string[];
  objections?: string[];
  channels?: string[];
  country?: string;
  demographics?: string;
  culturalContext?: string;
  bigFive?: BigFive;
  /** Missing = AI guess (shared/bigFive.ts). */
  bigFiveSource?: BigFiveSource;
  evidence?: string;
};

export type ContextJourney = {
  id: string;
  name: string;
  goal?: string;
  personaId?: string;
  stages: Array<{
    stage: string;
    cells: string[];
    score?: number;
  }>;
};

export type ContextBuild = {
  id: string;
  name: string;
  kind: "website" | "app";
  idea?: string;
  positioning?: string;
  differentiators?: string[];
  personaIds: string[];
  journeyMapIds: string[];
};

export type ContextPage = {
  id: string;
  name: string;
  path: string;
  goal?: string;
  personaId?: string;
  journeyStage?: string;
};

export type ContextPack = {
  projectId: string;
  builtAt: number;
  /** Plain-text business brief (lib/businessProfile.ts), first in every prompt. */
  businessBrief: string[];
  products: Array<{ id: string; title: string; price?: string; description?: string }>;
  personas: ContextPersona[];
  journeys: ContextJourney[];
  build?: ContextBuild;
  page?: ContextPage;
  evidence: ContextEvidence[];
  gaps: string[];
  assumptions: string[];
};

/** Deterministic provenance label for visible evidence; not cryptographic integrity. */
export function contextVersion(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function contextEvidence(input: Omit<ContextEvidence, "version">): ContextEvidence {
  return {
    ...input,
    version: contextVersion(JSON.stringify({
      source: input.source,
      title: input.title,
      trust: input.trust,
      text: input.text,
    })),
  };
}

/**
 * Keep evidence in one explicitly typed data block. This is a prompt boundary,
 * not a security claim about model behavior: feature actions expose no model
 * tool definitions, and source text is never parsed into tool arguments.
 */
export function serializeContextEvidence(evidence: ContextEvidence[]): string {
  return JSON.stringify(evidence.map((item) => ({
    ref: item.ref,
    version: item.version,
    source: item.source,
    title: item.title,
    trust: item.trust,
    text: item.text,
    truncated: item.truncated ?? false,
  })));
}

/** Structural shape of a stored Google top/total row (googleTopItems). */
export type ProviderMetricRow = {
  source: "ga4" | "gsc" | "gads";
  kind: string;
  rank: number;
  label: string;
  status?: string;
  sessions?: number;
  users?: number;
  keyEvents?: number;
  engagementRate?: number;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
  costMicros?: number;
  conversions?: number;
  currency?: string;
  periodStart: string;
  periodEnd: string;
  syncedAt: number;
};

function fmtCount(value: number | undefined): string {
  return Math.round(value ?? 0).toLocaleString("en-US");
}
function fmtPct(value: number | undefined): string {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}
function fmtChange(current: number | undefined, previous: number | undefined): string {
  if (previous === undefined || previous === 0 || current === undefined) return "";
  const change = ((current - previous) / previous) * 100;
  return ` (${change >= 0 ? "+" : ""}${change.toFixed(0)}% vs previous 28 days)`;
}
function fmtMoney(micros: number | undefined, currency: string | undefined): string {
  return `${((micros ?? 0) / 1_000_000).toFixed(2)}${currency ? ` ${currency}` : ""}`;
}

/**
 * Compact, bounded summary of synced Google metrics for the AI context pack.
 * Numbers come from Google via a verified sync; labels inside (search
 * queries, page paths, campaign names) are third-party text and stay data.
 * Returns null when nothing has been synced.
 */
export function providerMetricsText(rows: ProviderMetricRow[], limit = 3_500): string | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const of = (source: ProviderMetricRow["source"], kind: string) =>
    sorted.filter((row) => row.source === source && row.kind === kind);
  const lines: string[] = [];
  const period = sorted.find((row) => row.kind === "totals_current");
  const syncedAt = Math.max(...sorted.map((row) => row.syncedAt));
  if (period) lines.push(`Period: ${period.periodStart} to ${period.periodEnd}. Synced ${new Date(syncedAt).toISOString()}.`);

  const [ga4] = of("ga4", "totals_current");
  if (ga4) {
    const [prev] = of("ga4", "totals_previous");
    lines.push(
      `Google Analytics: visits ${fmtCount(ga4.sessions)}${fmtChange(ga4.sessions, prev?.sessions)}; visitors ${fmtCount(ga4.users)}${fmtChange(ga4.users, prev?.users)}; key events ${fmtCount(ga4.keyEvents)}${fmtChange(ga4.keyEvents, prev?.keyEvents)}; engagement rate ${fmtPct(ga4.engagementRate)}.`,
    );
    const pages = of("ga4", "landing_page").slice(0, 5);
    if (pages.length) lines.push(`Top landing pages: ${pages.map((row) => `${row.label} (${fmtCount(row.sessions)} visits)`).join("; ")}.`);
    const channels = of("ga4", "channel").slice(0, 5);
    if (channels.length) lines.push(`Traffic channels: ${channels.map((row) => `${row.label} (${fmtCount(row.sessions)})`).join("; ")}.`);
  }
  const [gsc] = of("gsc", "totals_current");
  if (gsc) {
    const [prev] = of("gsc", "totals_previous");
    lines.push(
      `Google Search Console: clicks ${fmtCount(gsc.clicks)}${fmtChange(gsc.clicks, prev?.clicks)}; impressions ${fmtCount(gsc.impressions)}${fmtChange(gsc.impressions, prev?.impressions)}; click rate ${fmtPct(gsc.ctr)}; average position ${(gsc.position ?? 0).toFixed(1)}.`,
    );
    const queries = of("gsc", "query").slice(0, 8);
    if (queries.length) lines.push(`Top search queries: ${queries.map((row) => `"${row.label}" (${fmtCount(row.clicks)} clicks, ${fmtCount(row.impressions)} impressions, position ${(row.position ?? 0).toFixed(1)})`).join("; ")}.`);
    const pages = of("gsc", "page").slice(0, 5);
    if (pages.length) lines.push(`Top search pages: ${pages.map((row) => `${row.label} (${fmtCount(row.clicks)} clicks)`).join("; ")}.`);
  }
  const [ads] = of("gads", "totals_current");
  if (ads) {
    const [prev] = of("gads", "totals_previous");
    lines.push(
      `Google Ads: spend ${fmtMoney(ads.costMicros, ads.currency)}${fmtChange(ads.costMicros, prev?.costMicros)}; clicks ${fmtCount(ads.clicks)}; impressions ${fmtCount(ads.impressions)}; conversions ${(ads.conversions ?? 0).toFixed(1)}${fmtChange(ads.conversions, prev?.conversions)}.`,
    );
    const campaigns = of("gads", "campaign").slice(0, 6);
    if (campaigns.length) lines.push(`Campaigns: ${campaigns.map((row) => `${row.label} [${row.status ?? "UNKNOWN"}] spend ${fmtMoney(row.costMicros, row.currency)}, ${fmtCount(row.clicks)} clicks, ${(row.conversions ?? 0).toFixed(1)} conversions`).join("; ")}.`);
  }
  const text = lines.join("\n");
  return text.length > limit ? text.slice(0, limit) : text;
}
