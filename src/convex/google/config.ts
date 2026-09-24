/**
 * Google (GA4, Search Console, Google Ads) — configuration, request builders
 * and response parsers. Pure module: no Convex functions, no `fetch`, so every
 * parser is unit-tested against fixtures (tests/unit/google-grow.test.ts).
 *
 * API versions live here and only here:
 *  - Google Ads REST `v25` (verified against developers.google.com Google Ads
 *    API docs, Sep 2026 — reporting/example + get-started/make-first-call).
 *    Google sunsets Ads API versions roughly yearly: bump this one constant
 *    and re-run the parser tests when the sunset notice arrives.
 *  - GA4 Data API `v1beta` (`properties/{id}:batchRunReports`).
 *  - GA4 Admin API `v1beta` (`accountSummaries`).
 *  - Search Console `webmasters/v3` on searchconsole.googleapis.com.
 *
 * These are fixed Google endpoints (never user-supplied URLs), so `safeFetch`
 * is not required; user-chosen ids are validated and URL-encoded.
 */

export const GOOGLE_ADS_API_VERSION = "v25";
export const GOOGLE_ADS_API = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}`;
export const GA4_DATA_API = "https://analyticsdata.googleapis.com/v1beta";
export const GA4_ADMIN_API = "https://analyticsadmin.googleapis.com/v1beta";
export const GSC_API = "https://searchconsole.googleapis.com/webmasters/v3";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const SCOPE_GA4 = "https://www.googleapis.com/auth/analytics.readonly";
export const SCOPE_GSC = "https://www.googleapis.com/auth/webmasters.readonly";
export const SCOPE_ADS = "https://www.googleapis.com/auth/adwords";
/** `openid email` only label the connection ("connected as …"). */
export const GOOGLE_SCOPES = ["openid", "email", SCOPE_GA4, SCOPE_GSC, SCOPE_ADS];

/** `oauthStates.platform` marker. Distinct from the ads `google` platform so
 *  neither callback can consume the other's state. */
export const GOOGLE_STATE_PLATFORM = "google_grow";
export const GOOGLE_CALLBACK_PATH = "/api/google/callback";
export const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;

export const GOOGLE_SOURCES = ["ga4", "gsc", "gads"] as const;
export type GoogleSource = (typeof GOOGLE_SOURCES)[number];

export const SOURCE_SCOPE: Record<GoogleSource, string> = {
  ga4: SCOPE_GA4,
  gsc: SCOPE_GSC,
  gads: SCOPE_ADS,
};

/** Bounds: rows per list and resources per listing. */
export const TOP_LIMIT = 10;
export const CAMPAIGN_LIMIT = 25;
export const RESOURCE_LIMIT = 200;
export const ADS_CUSTOMER_DESCRIBE_LIMIT = 20;
export const WINDOW_DAYS = 28;

// ── Environment ───────────────────────────────────────────────────────────

export type GoogleOAuthEnv = { clientId: string; clientSecret: string };

/** Prefer the dedicated Google OAuth client; fall back to the Ads client. */
export function googleOAuthEnv(): GoogleOAuthEnv | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret =
    process.env.GOOGLE_OAUTH_CLIENT_ID
      ? process.env.GOOGLE_OAUTH_CLIENT_SECRET
      : process.env.GOOGLE_ADS_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export function googleAdsDeveloperToken(): string | null {
  return process.env.GOOGLE_ADS_DEVELOPER_TOKEN || null;
}

/** Optional manager (MCC) id sent as `login-customer-id`. Digits only. */
export function googleAdsLoginCustomerId(): string | null {
  const raw = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "");
  return raw && /^\d{6,12}$/.test(raw) ? raw : null;
}

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  // Offline access + forced consent so Google returns a refresh token.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export function grantedSources(scope: string | undefined): Record<GoogleSource, boolean> {
  const granted = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  return {
    ga4: granted.has(SCOPE_GA4),
    gsc: granted.has(SCOPE_GSC),
    gads: granted.has(SCOPE_ADS),
  };
}

/** Email claim from an id_token received directly from Google's token
 *  endpoint over TLS (Google documents this as trustworthy without signature
 *  checks). Used as a display label only — never for authorization. */
export function emailFromIdToken(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  const part = idToken.split(".")[1];
  if (!part) return undefined;
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(padded)) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.length <= 320
      ? payload.email
      : undefined;
  } catch {
    return undefined;
  }
}

// ── Dates ─────────────────────────────────────────────────────────────────

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export type DateWindow = { start: string; end: string };
export type ReportWindows = { current: DateWindow; previous: DateWindow };

/** The last 28 complete days (ending yesterday, UTC) and the 28 before. */
export function reportWindows(now = Date.now()): ReportWindows {
  const today = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z");
  const end = addDays(today, -1);
  const currentStart = addDays(end, -(WINDOW_DAYS - 1));
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -(WINDOW_DAYS - 1));
  return {
    current: { start: isoDate(currentStart), end: isoDate(end) },
    previous: { start: isoDate(previousStart), end: isoDate(previousEnd) },
  };
}

/** GA4 reports dates as `YYYYMMDD`. */
export function ga4Date(value: string): string | null {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : null;
}

// ── Error classification ──────────────────────────────────────────────────

export type GoogleErrorKind =
  | "unauthorized"
  | "forbidden"
  | "api_disabled"
  | "quota"
  | "not_found"
  | "bad_request"
  | "provider_error"
  | "network";

export type GoogleError = { kind: GoogleErrorKind; status?: number; code?: string };

/** Enum-like machine codes (e.g. `PERMISSION_DENIED`,
 *  `DEVELOPER_TOKEN_NOT_APPROVED`) are safe to record. Free text never is. */
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

function collectCodes(node: unknown, out: string[], depth = 0): void {
  if (depth > 10 || out.length > 12 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectCodes(item, out, depth + 1);
    return;
  }
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "message" || key === "description") continue;
    if (typeof value === "string") {
      if ((key === "status" || key === "reason" || key.endsWith("Error") || key === "code") && SAFE_CODE.test(value)) {
        out.push(value);
      }
    } else {
      collectCodes(value, out, depth + 1);
    }
  }
}

/** Classify a failed Google response. Only the HTTP status and enum-like
 *  codes survive; Google's free-text messages are discarded. */
export function classifyGoogleError(status: number, body: unknown): GoogleError {
  const codes: string[] = [];
  collectCodes(body, codes);
  const specific =
    codes.find((code) => !["PERMISSION_DENIED", "UNAUTHENTICATED", "INVALID_ARGUMENT", "RESOURCE_EXHAUSTED", "NOT_FOUND", "FAILED_PRECONDITION", "INTERNAL", "UNAVAILABLE"].includes(code)) ??
    codes[0];
  const has = (code: string) => codes.includes(code);
  if (status === 401 || has("UNAUTHENTICATED")) return { kind: "unauthorized", status, code: specific };
  if (has("SERVICE_DISABLED") || has("ACCESS_NOT_CONFIGURED") || has("accessNotConfigured")) {
    return { kind: "api_disabled", status, code: specific };
  }
  if (status === 429 || has("RESOURCE_EXHAUSTED") || has("RATE_LIMIT_EXCEEDED") || has("RESOURCE_TEMPORARILY_EXHAUSTED")) {
    return { kind: "quota", status, code: specific };
  }
  if (status === 403 || has("PERMISSION_DENIED")) return { kind: "forbidden", status, code: specific };
  if (status === 404) return { kind: "not_found", status, code: specific };
  if (status === 400) return { kind: "bad_request", status, code: specific };
  return { kind: "provider_error", status, code: specific };
}

/** Plain-language copy for a small-business owner. No env var names. */
export function googleErrorMessage(source: GoogleSource | "account", error: GoogleError): string {
  const product =
    source === "ga4" ? "Google Analytics" : source === "gsc" ? "Search Console" : source === "gads" ? "Google Ads" : "Google";
  const code = error.code ?? "";
  if (code.startsWith("DEVELOPER_TOKEN") || code === "NOT_ADS_USER" || code === "USER_PERMISSION_DENIED") {
    return code === "NOT_ADS_USER"
      ? "This Google account has no Google Ads access."
      : "Google Ads access isn't approved for this workspace yet — ask your admin.";
  }
  if (code === "CUSTOMER_NOT_ENABLED") return "This Google Ads account isn't active.";
  if (code === "REQUESTED_METRICS_FOR_MANAGER") {
    return "This is a Google Ads manager account — pick one of its client accounts instead.";
  }
  switch (error.kind) {
    case "unauthorized":
      return "Google no longer accepts this connection — reconnect Google.";
    case "api_disabled":
      return `The ${product} API isn't switched on for this workspace yet — ask your admin.`;
    case "quota":
      return `${product} is limiting requests right now. We'll try again later.`;
    case "forbidden":
      return `Your Google account doesn't have access to this ${product} ${source === "gsc" ? "site" : source === "gads" ? "account" : "property"}.`;
    case "not_found":
      return `${product} couldn't find the selected ${source === "gsc" ? "site" : source === "gads" ? "account" : "property"}. Pick it again.`;
    case "bad_request":
      return `${product} rejected the request. We've recorded it — try again later.`;
    case "network":
      return `We couldn't reach ${product}. We'll try again later.`;
    default:
      return `${product} returned an error. We'll try again later.`;
  }
}

// ── Small parse helpers ───────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
/** Google encodes int64 as strings in REST JSON; doubles as numbers. */
export function num(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}
function clip(value: string, max = 300): string {
  return value.length > max ? value.slice(0, max) : value;
}

// ── Resource listings ─────────────────────────────────────────────────────

export type Ga4Property = { id: string; name: string; account?: string };

/** Analytics Admin `accountSummaries.list`. */
export function parseAccountSummaries(body: unknown): { properties: Ga4Property[]; nextPageToken?: string } {
  const root = asRecord(body);
  const properties: Ga4Property[] = [];
  for (const summary of asArray(root.accountSummaries)) {
    const account = asRecord(summary);
    for (const property of asArray(account.propertySummaries)) {
      const p = asRecord(property);
      const resource = asString(p.property);
      const id = resource?.startsWith("properties/") ? resource.slice("properties/".length) : undefined;
      if (!id || !/^\d+$/.test(id)) continue;
      properties.push({
        id,
        name: clip(asString(p.displayName) ?? id, 200),
        account: asString(account.displayName) ? clip(asString(account.displayName)!, 200) : undefined,
      });
    }
  }
  return { properties, nextPageToken: asString(root.nextPageToken) || undefined };
}

export type GscSite = { siteUrl: string; permission?: string };

/** Search Console `sites.list`. Unverified sites cannot be queried. */
export function parseGscSites(body: unknown): GscSite[] {
  return asArray(asRecord(body).siteEntry)
    .map((entry) => asRecord(entry))
    .filter((entry) => typeof entry.siteUrl === "string" && entry.permissionLevel !== "siteUnverifiedUser")
    .map((entry) => ({
      siteUrl: clip(entry.siteUrl as string, 500),
      permission: asString(entry.permissionLevel),
    }))
    .slice(0, RESOURCE_LIMIT);
}

/** Google Ads `customers:listAccessibleCustomers` → bare customer ids. */
export function parseAccessibleCustomers(body: unknown): string[] {
  return asArray(asRecord(body).resourceNames)
    .map((name) => asString(name) ?? "")
    .filter((name) => /^customers\/\d+$/.test(name))
    .map((name) => name.slice("customers/".length))
    .slice(0, RESOURCE_LIMIT);
}

// ── Google Ads searchStream ───────────────────────────────────────────────

/** `searchStream` returns an array of batches, each with `results`. */
export function flattenAdsStream(body: unknown): Record<string, unknown>[] {
  const batches = Array.isArray(body) ? body : [body];
  const out: Record<string, unknown>[] = [];
  for (const batch of batches) {
    for (const row of asArray(asRecord(batch).results)) out.push(asRecord(row));
  }
  return out;
}

export type AdsCustomerInfo = { id: string; name?: string; currency?: string; manager: boolean };

export function parseAdsCustomer(body: unknown): AdsCustomerInfo | null {
  const row = flattenAdsStream(body)[0];
  if (!row) return null;
  const customer = asRecord(row.customer);
  const id = asString(customer.id) ?? (typeof customer.id === "number" ? String(customer.id) : undefined);
  if (!id) return null;
  return {
    id,
    name: asString(customer.descriptiveName) ? clip(asString(customer.descriptiveName)!, 200) : undefined,
    currency: asString(customer.currencyCode),
    manager: customer.manager === true,
  };
}

export function adsCustomerQuery(): string {
  return "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1";
}

export function adsDailyQuery(window: DateWindow): string {
  return `SELECT segments.date, customer.currency_code, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'`;
}

export function adsCampaignQuery(window: DateWindow): string {
  return `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${window.start}' AND '${window.end}' AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT ${CAMPAIGN_LIMIT}`;
}

export type DailyMetrics = {
  date: string;
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
};

export function parseAdsDaily(body: unknown): { rows: DailyMetrics[]; currency?: string } {
  const byDate = new Map<string, DailyMetrics>();
  let currency: string | undefined;
  for (const row of flattenAdsStream(body)) {
    const date = asString(asRecord(row.segments).date);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const metrics = asRecord(row.metrics);
    currency = asString(asRecord(row.customer).currencyCode) ?? currency;
    const prev = byDate.get(date);
    byDate.set(date, {
      date,
      costMicros: Math.round((prev?.costMicros ?? 0) + num(metrics.costMicros)),
      impressions: (prev?.impressions ?? 0) + num(metrics.impressions),
      clicks: (prev?.clicks ?? 0) + num(metrics.clicks),
      conversions: (prev?.conversions ?? 0) + num(metrics.conversions),
    });
  }
  const rows = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({ ...row, currency }));
  return { rows, currency };
}

export type CampaignRow = {
  id: string;
  name: string;
  status: string;
  costMicros: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

export function parseAdsCampaigns(body: unknown): CampaignRow[] {
  return flattenAdsStream(body)
    .map((row) => {
      const campaign = asRecord(row.campaign);
      const metrics = asRecord(row.metrics);
      const id = asString(campaign.id) ?? (typeof campaign.id === "number" ? String(campaign.id) : "");
      return {
        id,
        name: clip(asString(campaign.name) ?? id, 200),
        status: asString(campaign.status) ?? "UNKNOWN",
        costMicros: Math.round(num(metrics.costMicros)),
        impressions: num(metrics.impressions),
        clicks: num(metrics.clicks),
        conversions: num(metrics.conversions),
      };
    })
    .filter((row) => row.id !== "")
    .slice(0, CAMPAIGN_LIMIT);
}

// ── GA4 Data API ──────────────────────────────────────────────────────────

export const GA4_METRICS = ["sessions", "totalUsers", "keyEvents", "engagementRate"] as const;

/** One `batchRunReports` call: daily series, period totals, top landing
 *  pages, top channels. */
export function ga4BatchRequest(windows: ReportWindows) {
  const metrics = GA4_METRICS.map((name) => ({ name }));
  const current = { startDate: windows.current.start, endDate: windows.current.end };
  const previous = { startDate: windows.previous.start, endDate: windows.previous.end };
  const whole = { startDate: windows.previous.start, endDate: windows.current.end };
  const bySessions = [{ metric: { metricName: "sessions" }, desc: true }];
  return {
    requests: [
      { dateRanges: [whole], dimensions: [{ name: "date" }], metrics, limit: "100" },
      { dateRanges: [current, previous], metrics },
      { dateRanges: [current], dimensions: [{ name: "landingPage" }], metrics: metrics.slice(0, 3), orderBys: bySessions, limit: String(TOP_LIMIT) },
      { dateRanges: [current], dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: metrics.slice(0, 3), orderBys: bySessions, limit: String(TOP_LIMIT) },
    ],
  };
}

type Ga4Row = { dims: string[]; values: Record<string, number> };

function ga4Rows(report: unknown): Ga4Row[] {
  const root = asRecord(report);
  const dimNames = asArray(root.dimensionHeaders).map((h) => asString(asRecord(h).name) ?? "");
  const metricNames = asArray(root.metricHeaders).map((h) => asString(asRecord(h).name) ?? "");
  return asArray(root.rows).map((raw) => {
    const row = asRecord(raw);
    const dims = asArray(row.dimensionValues).map((d) => asString(asRecord(d).value) ?? "");
    const values: Record<string, number> = {};
    asArray(row.metricValues).forEach((m, index) => {
      const name = metricNames[index];
      if (name) values[name] = num(asRecord(m).value);
    });
    // Keep the dateRange dimension addressable by name.
    const named: string[] = [];
    dimNames.forEach((name, index) => {
      named[index] = dims[index] ?? "";
      if (name === "dateRange") values.__dateRange = dims[index] === "date_range_1" ? 1 : 0;
    });
    return { dims: named, values };
  });
}

export type Ga4Parsed = {
  daily: DailyMetrics[];
  totals: { current?: DailyMetrics; previous?: DailyMetrics };
  landingPages: Array<{ label: string; sessions: number; users: number; keyEvents: number }>;
  channels: Array<{ label: string; sessions: number; users: number; keyEvents: number }>;
};

export function parseGa4Batch(body: unknown): Ga4Parsed {
  const reports = asArray(asRecord(body).reports);
  const daily = ga4Rows(reports[0])
    .map((row) => {
      const date = ga4Date(row.dims[0] ?? "");
      if (!date) return null;
      return {
        date,
        sessions: row.values.sessions ?? 0,
        users: row.values.totalUsers ?? 0,
        keyEvents: row.values.keyEvents ?? 0,
        engagementRate: row.values.engagementRate ?? 0,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const totals: Ga4Parsed["totals"] = {};
  for (const row of ga4Rows(reports[1])) {
    const entry: DailyMetrics = {
      date: "",
      sessions: row.values.sessions ?? 0,
      users: row.values.totalUsers ?? 0,
      keyEvents: row.values.keyEvents ?? 0,
      engagementRate: row.values.engagementRate ?? 0,
    };
    if (row.values.__dateRange === 1) totals.previous = entry;
    else totals.current = entry;
  }
  const top = (report: unknown) =>
    ga4Rows(report)
      .slice(0, TOP_LIMIT)
      .map((row) => ({
        label: clip(row.dims[0] || "(not set)", 300),
        sessions: row.values.sessions ?? 0,
        users: row.values.totalUsers ?? 0,
        keyEvents: row.values.keyEvents ?? 0,
      }));
  return { daily, totals, landingPages: top(reports[2]), channels: top(reports[3]) };
}

// ── Search Console ────────────────────────────────────────────────────────

export function gscQuery(window: DateWindow, dimension: "date" | "query" | "page", rowLimit: number) {
  return {
    startDate: window.start,
    endDate: window.end,
    dimensions: [dimension],
    rowLimit,
    dataState: "final",
  };
}

export type GscRow = { key: string; clicks: number; impressions: number; ctr: number; position: number };

export function parseGscRows(body: unknown): GscRow[] {
  return asArray(asRecord(body).rows).map((raw) => {
    const row = asRecord(raw);
    return {
      key: clip(asString(asArray(row.keys)[0]) ?? "", 500),
      clicks: num(row.clicks),
      impressions: num(row.impressions),
      ctr: num(row.ctr),
      position: num(row.position),
    };
  });
}

/** Search Console has no period totals endpoint: aggregate daily rows.
 *  Position is impression-weighted, CTR is clicks / impressions. */
export function aggregateGsc(rows: Array<{ date: string; clicks?: number; impressions?: number; position?: number }>, window: DateWindow): DailyMetrics {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const row of rows) {
    if (row.date < window.start || row.date > window.end) continue;
    clicks += row.clicks ?? 0;
    impressions += row.impressions ?? 0;
    weighted += (row.position ?? 0) * (row.impressions ?? 0);
  }
  return {
    date: "",
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weighted / impressions : 0,
  };
}

export function aggregateAds(rows: DailyMetrics[], window: DateWindow): DailyMetrics {
  const out: DailyMetrics = { date: "", costMicros: 0, impressions: 0, clicks: 0, conversions: 0 };
  for (const row of rows) {
    if (row.date < window.start || row.date > window.end) continue;
    out.costMicros = (out.costMicros ?? 0) + (row.costMicros ?? 0);
    out.impressions = (out.impressions ?? 0) + (row.impressions ?? 0);
    out.clicks = (out.clicks ?? 0) + (row.clicks ?? 0);
    out.conversions = (out.conversions ?? 0) + (row.conversions ?? 0);
  }
  out.costMicros = Math.round(out.costMicros ?? 0);
  return out;
}

/** Percentage change, or null when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / previous;
}

/** Google Ads customer ids are 10 digits (the UI shows 123-456-7890). */
export function normalizeCustomerId(value: string): string | null {
  const digits = value.replace(/-/g, "");
  return /^\d{6,12}$/.test(digits) ? digits : null;
}
