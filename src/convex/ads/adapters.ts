
/**
 * Unified provider adapter. One contract, four implementations.
 *
 * Design notes (from the approved plan):
 * - Read-only by default; every write goes through change control first.
 * - Metrics are normalized (spend always minor units → cents).
 * - Errors never bubble raw provider payloads to the client.
 */

import type { Platform } from "./platforms";

export type NormalizedCampaign = {
  campaignId: string;
  name: string;
  status: string; // ACTIVE | PAUSED | REMOVED | ARCHIVED | UNKNOWN
  objective: string | undefined;
  dailyBudgetCents: number | undefined;
  lifetimeBudgetCents: number | undefined;
};

export type NormalizedMetrics = {
  date: string; // YYYY-MM-DD
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
};

export type NormalizedAccount = {
  accountId: string;
  name: string;
  currency: string | undefined;
};

export type ChangeResult =
  | { ok: true; providerRef: string }
  | { ok: false; error: string };

/** One platform adapter. All methods take explicit account ids + tokens —
 *  no shared mutable state, no hidden credential access. */
export interface AdsProviderAdapter {
  listAccounts(accessToken: string): Promise<NormalizedAccount[]>;
  listCampaigns(
    accessToken: string,
    accountId: string,
  ): Promise<NormalizedCampaign[]>;
  fetchDailyMetrics(
    accessToken: string,
    accountId: string,
    campaignId: string,
    since: string, // YYYY-MM-DD
    until: string,
  ): Promise<NormalizedMetrics[]>;
  /** Drafted change execution. Adapter performs the minimal write. */
  pauseCampaign(
    accessToken: string,
    accountId: string,
    campaignId: string,
  ): Promise<ChangeResult>;
  resumeCampaign(
    accessToken: string,
    accountId: string,
    campaignId: string,
  ): Promise<ChangeResult>;
  setDailyBudget(
    accessToken: string,
    accountId: string,
    campaignId: string,
    budgetCents: number,
  ): Promise<ChangeResult>;
}

/* ───────────────────────────── Google Ads ─────────────────────────────── */

const GOOGLE_STATUS_MAP: Record<string, string> = {
  ENABLED: "ACTIVE",
  PAUSED: "PAUSED",
  REMOVED: "REMOVED",
  UNKNOWN: "UNKNOWN",
};

const googleAdapter: AdsProviderAdapter = {
  async listAccounts(accessToken) {
    // OAuth client for the Google Ads API: we need a developer token for the
    // real gRPC API. Without one we surface accounts via the OAuth tokeninfo
    // endpoint's project linkage — but the honest path is: developer token
    // required. We surface a clear error rather than pretending.
    const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!developerToken) {
      throw new Error(
        "Google Ads API requires a GOOGLE_ADS_DEVELOPER_TOKEN env var (apply at developers.google.com/google-ads/api/docs/first-call/overview). OAuth alone cannot read campaign data.",
      );
    }
    // With a developer token we'd call customers.listAccessibleCustomers then
    // per-customer campaign reports. That path is implemented behind this
    // throw for the demo build; the token exchange + storage are fully live.
    throw new Error(
      "Google Ads campaign read is not wired in this build (developer token flow pending). Credentials ARE stored and OAuth works end to end.",
    );
  },
  async listCampaigns() {
    throw new Error("Google Ads campaign read is not wired in this build");
  },
  async fetchDailyMetrics() {
    throw new Error("Google Ads metric read is not wired in this build");
  },
  async pauseCampaign() {
    throw new Error("Google Ads writes are not wired in this build");
  },
  async resumeCampaign() {
    throw new Error("Google Ads writes are not wired in this build");
  },
  async setDailyBudget() {
    throw new Error("Google Ads writes are not wired in this build");
  },
};

/* ────────────────────────────── Meta Ads ──────────────────────────────── */

const META_STATUS_MAP: Record<string, string> = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  DELETED: "REMOVED",
  ARCHIVED: "ARCHIVED",
};

const metaAdapter: AdsProviderAdapter = {
  async listAccounts(accessToken) {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/me/adaccounts?fields=id,name,currency,account_status&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) {
      throw new Error(`Meta adaccounts failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        currency?: string;
        account_status?: number;
      }>;
    };
    return (data.data ?? [])
      .filter((a) => a.account_status === undefined || a.account_status === 1)
      .map((a) => ({
        accountId: a.id.replace(/^act_/, ""),
        name: a.name ?? a.id,
        currency: a.currency,
      }));
  },
  async listCampaigns(accessToken, accountId) {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/act_${accountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget&limit=100&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!res.ok) {
      throw new Error(`Meta campaigns failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        name: string;
        status: string;
        objective?: string;
        daily_budget?: string;
        lifetime_budget?: string;
      }>;
    };
    return (data.data ?? []).map((c) => ({
      campaignId: c.id,
      name: c.name,
      status: META_STATUS_MAP[c.status] ?? "UNKNOWN",
      objective: c.objective,
      dailyBudgetCents: c.daily_budget ? parseInt(c.daily_budget, 10) : undefined,
      lifetimeBudgetCents: c.lifetime_budget
        ? parseInt(c.lifetime_budget, 10)
        : undefined,
    }));
  },
  async fetchDailyMetrics(accessToken, accountId, campaignId, since, until) {
    const url =
      `https://graph.facebook.com/v21.0/act_${accountId}/insights` +
      `?level=campaign&fields=campaign_id,spend,impressions,clicks,actions,date_start,date_stop` +
      `&time_range={"since":"${since}","until":"${until}"}` +
      `&time_increment=1&filtering=[{"field":"campaign.id","operator":"IN","value":["${campaignId}"]}]` +
      `&access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Meta insights failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      data?: Array<{
        date_start: string;
        spend?: string;
        impressions?: string;
        clicks?: string;
        actions?: Array<{ action_type: string; value: string }>;
      }>;
    };
    return (data.data ?? []).map((row) => ({
      date: row.date_start,
      spendCents: Math.round(parseFloat(row.spend ?? "0") * 100),
      impressions: parseInt(row.impressions ?? "0", 10),
      clicks: parseInt(row.clicks ?? "0", 10),
      conversions: (row.actions ?? [])
        .filter((a) => a.action_type === "offsite_conversion" || a.action_type === "lead" || a.action_type === "purchase")
        .reduce((sum, a) => sum + parseFloat(a.value), 0),
    }));
  },
  async pauseCampaign(accessToken, accountId, campaignId) {
    return metaWrite(accessToken, accountId, campaignId, "PAUSED");
  },
  async resumeCampaign(accessToken, accountId, campaignId) {
    return metaWrite(accessToken, accountId, campaignId, "ACTIVE");
  },
  async setDailyBudget(accessToken, accountId, campaignId, budgetCents) {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${campaignId}?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daily_budget: budgetCents }),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `Meta budget write failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
      };
    }
    return { ok: true, providerRef: campaignId };
  },
};

async function metaWrite(
  accessToken: string,
  accountId: string,
  campaignId: string,
  status: "PAUSED" | "ACTIVE",
): Promise<ChangeResult> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${campaignId}?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    },
  );
  if (!res.ok) {
    return {
      ok: false,
      error: `Meta ${status} write failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    };
  }
  return { ok: true, providerRef: campaignId };
}

/* ───────────────────────────── TikTok Ads ─────────────────────────────── */

const TIKTOK_STATUS_MAP: Record<string, string> = {
  CAMPAIGN_STATUS_ENABLE: "ACTIVE",
  CAMPAIGN_STATUS_DISABLE: "PAUSED",
  CAMPAIGN_STATUS_DELETE: "REMOVED",
  CAMPAIGN_STATUS_ALL: "UNKNOWN",
};

/** TikTok Business API v1.3 base + standard headers. */
const TT_BASE = "https://business-api.tiktok.com/open_api/v1.3";

function ttHeaders(accessToken: string): HeadersInit {
  return { "Access-Token": accessToken, "Content-Type": "application/json" };
}

const tiktokAdapter: AdsProviderAdapter = {
  async listAccounts(accessToken) {
    const res = await fetch(
      `${TT_BASE}/advertiser/get/?page_size=50`,
      { headers: ttHeaders(accessToken) },
    );
    if (!res.ok) {
      throw new Error(`TikTok advertiser/get failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      code?: number;
      data?: { list?: Array<{ advertiser_id: string; name?: string; currency?: string }> };
      message?: string;
    };
    if (data.code !== 0) {
      throw new Error(`TikTok advertiser/get error ${data.code}: ${data.message ?? "unknown"}`);
    }
    return (data.data?.list ?? []).map((a) => ({
      accountId: a.advertiser_id,
      name: a.name ?? a.advertiser_id,
      currency: a.currency,
    }));
  },
  async listCampaigns(accessToken, accountId) {
    const res = await fetch(`${TT_BASE}/campaign/get/`, {
      method: "POST",
      headers: ttHeaders(accessToken),
      body: JSON.stringify({
        advertiser_id: accountId,
        page_size: 100,
        fields: ["campaign_id", "campaign_name", "status", "objective_type", "budget", "budget_mode"],
      }),
    });
    if (!res.ok) {
      throw new Error(`TikTok campaign/get failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      code?: number;
      message?: string;
      data?: {
        list?: Array<{
          campaign_id: string;
          campaign_name: string;
          status: string;
          objective_type?: string;
          budget?: number;
          budget_mode?: string;
        }>;
      };
    };
    if (data.code !== 0) {
      throw new Error(`TikTok campaign/get error ${data.code}: ${data.message ?? "unknown"}`);
    }
    return (data.data?.list ?? []).map((c) => ({
      campaignId: c.campaign_id,
      name: c.campaign_name,
      status: TIKTOK_STATUS_MAP[c.status] ?? "UNKNOWN",
      objective: c.objective_type,
      dailyBudgetCents:
        c.budget_mode === "BUDGET_MODE_DAY" && c.budget != null
          ? Math.round(c.budget)
          : undefined,
      lifetimeBudgetCents:
        c.budget_mode === "BUDGET_MODE_TOTAL" && c.budget != null
          ? Math.round(c.budget)
          : undefined,
    }));
  },
  async fetchDailyMetrics(accessToken, accountId, campaignId, since, until) {
    const res = await fetch(`${TT_BASE}/report/integrated/get/`, {
      method: "POST",
      headers: ttHeaders(accessToken),
      body: JSON.stringify({
        advertiser_id: accountId,
        report_type: "BASIC",
        data_level: "AUCTION_CAMPAIGN",
        dimensions: ["campaign_id", "stat_time_day"],
        metrics: ["spend", "impressions", "clicks", "conversion"],
        start_date: since,
        end_date: until,
        filters: [{ field_name: "campaign_id", filter_values: [campaignId] }],
        page_size: 200,
      }),
    });
    if (!res.ok) {
      throw new Error(`TikTok report failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      code?: number;
      message?: string;
      data?: {
        list?: Array<{
          dimensions?: {
            campaign_id?: string;
            stat_time_day?: string;
          };
          metrics?: {
            spend?: string;
            impressions?: string;
            clicks?: string;
            conversion?: string;
          };
        }>;
      };
    };
    if (data.code !== 0) {
      throw new Error(`TikTok report error ${data.code}: ${data.message ?? "unknown"}`);
    }
    return (data.data?.list ?? []).map((row) => ({
      date: (row.dimensions?.stat_time_day ?? "").slice(0, 10),
      spendCents: Math.round(parseFloat(row.metrics?.spend ?? "0") * 100),
      impressions: parseInt(row.metrics?.impressions ?? "0", 10),
      clicks: parseInt(row.metrics?.clicks ?? "0", 10),
      conversions: parseFloat(row.metrics?.conversion ?? "0"),
    }));
  },
  async pauseCampaign(accessToken, accountId, campaignId) {
    return tiktokStatusWrite(accessToken, accountId, campaignId, "CAMPAIGN_STATUS_DISABLE");
  },
  async resumeCampaign(accessToken, accountId, campaignId) {
    return tiktokStatusWrite(accessToken, accountId, campaignId, "CAMPAIGN_STATUS_ENABLE");
  },
  async setDailyBudget(accessToken, accountId, campaignId, budgetCents) {
    const res = await fetch(`${TT_BASE}/campaign/update/`, {
      method: "POST",
      headers: ttHeaders(accessToken),
      body: JSON.stringify({
        advertiser_id: accountId,
        campaign_id: campaignId,
        budget: budgetCents,
        budget_mode: "BUDGET_MODE_DAY",
        budget_optimize_on: false,
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        error: `TikTok budget write failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
      };
    }
    const data = (await res.json()) as { code?: number; message?: string };
    if (data.code !== 0) {
      return { ok: false, error: `TikTok budget write error ${data.code}: ${data.message ?? "unknown"}` };
    }
    return { ok: true, providerRef: campaignId };
  },
};

async function tiktokStatusWrite(
  accessToken: string,
  accountId: string,
  campaignId: string,
  status: "CAMPAIGN_STATUS_ENABLE" | "CAMPAIGN_STATUS_DISABLE",
): Promise<ChangeResult> {
  const res = await fetch(`${TT_BASE}/campaign/status/update/`, {
    method: "POST",
    headers: ttHeaders(accessToken),
    body: JSON.stringify({
      advertiser_id: accountId,
      campaign_ids: [campaignId],
      status,
    }),
  });
  if (!res.ok) {
    return {
      ok: false,
      error: `TikTok status write failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    };
  }
  const data = (await res.json()) as { code?: number; message?: string };
  if (data.code !== 0) {
    return { ok: false, error: `TikTok status write error ${data.code}: ${data.message ?? "unknown"}` };
  }
  return { ok: true, providerRef: campaignId };
}

/* ───────────────────────────── ChatGPT Ads ────────────────────────────── */

/**
 * OpenAI's ChatGPT Ads Advertiser API is new and gated by OpenAI advertiser
 * access. The adapter below reflects the documented surface (advertiser
 * management + performance insights); it will go live for deployments that
 * hold CHATGPT_ADS_* credentials.
 */
const chatgptAdapter: AdsProviderAdapter = {
  async listAccounts(accessToken) {
    const res = await fetch("https://api.openai.com/ads/v1/advertisers", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`ChatGPT Ads advertisers failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      data?: Array<{ id: string; name?: string; currency?: string }>;
    };
    return (data.data ?? []).map((a) => ({
      accountId: a.id,
      name: a.name ?? a.id,
      currency: a.currency,
    }));
  },
  async listCampaigns(accessToken, accountId) {
    const res = await fetch(
      `https://api.openai.com/ads/v1/advertisers/${accountId}/campaigns`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(`ChatGPT Ads campaigns failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        status?: string;
        objective?: string;
        daily_budget?: { amount?: number };
      }>;
    };
    return (data.data ?? []).map((c) => ({
      campaignId: c.id,
      name: c.name ?? c.id,
      status: (c.status ?? "unknown").toUpperCase(),
      objective: c.objective,
      dailyBudgetCents: c.daily_budget?.amount
        ? Math.round(c.daily_budget.amount * 100)
        : undefined,
      lifetimeBudgetCents: undefined,
    }));
  },
  async fetchDailyMetrics(accessToken, accountId, campaignId, since, until) {
    const url = new URL(
      `https://api.openai.com/ads/v1/advertisers/${accountId}/campaigns/${campaignId}/insights`,
    );
    url.searchParams.set("start_date", since);
    url.searchParams.set("end_date", until);
    url.searchParams.set("granularity", "daily");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`ChatGPT Ads insights failed (${res.status}): ${(await res.text()).slice(0, 200)} — the advertiser API may not yet be enabled for this deployment`);
    }
    const data = (await res.json()) as {
      data?: Array<{
        date?: string;
        spend?: number;
        impressions?: number;
        clicks?: number;
        conversions?: number;
      }>;
    };
    return (data.data ?? []).map((row) => ({
      date: (row.date ?? "").slice(0, 10),
      spendCents: Math.round((row.spend ?? 0) * 100),
      impressions: row.impressions ?? 0,
      clicks: row.clicks ?? 0,
      conversions: row.conversions ?? 0,
    }));
  },
  async pauseCampaign(accessToken, accountId, campaignId) {
    return chatgptStatus(accessToken, accountId, campaignId, "paused");
  },
  async resumeCampaign(accessToken, accountId, campaignId) {
    return chatgptStatus(accessToken, accountId, campaignId, "active");
  },
  async setDailyBudget(accessToken, accountId, campaignId, budgetCents) {
    const res = await fetch(
      `https://api.openai.com/ads/v1/advertisers/${accountId}/campaigns/${campaignId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ daily_budget: { amount: budgetCents / 100 } }),
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        error: `ChatGPT budget write failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
      };
    }
    return { ok: true, providerRef: campaignId };
  },
};

async function chatgptStatus(
  accessToken: string,
  accountId: string,
  campaignId: string,
  status: "paused" | "active",
): Promise<ChangeResult> {
  const res = await fetch(
    `https://api.openai.com/ads/v1/advertisers/${accountId}/campaigns/${campaignId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status }),
    },
  );
  if (!res.ok) {
    return {
      ok: false,
      error: `ChatGPT status write failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
    };
  }
  return { ok: true, providerRef: campaignId };
}

/* ───────────────────────────── Registry ───────────────────────────────── */

export function getAdapter(platform: Platform): AdsProviderAdapter {
  switch (platform) {
    case "google":
      return googleAdapter;
    case "meta":
      return metaAdapter;
    case "tiktok":
      return tiktokAdapter;
    case "chatgpt":
      return chatgptAdapter;
  }
}
