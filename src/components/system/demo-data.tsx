import { cn } from "@/lib/utils";

/** Tiny monochrome SVG sparkline — data-density demo for metric cards. */
export function Sparkline({
  data,
  up = true,
  className,
}: {
  data: number[];
  up?: boolean;
  className?: string;
}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const pts = data
    .map(
      (v, i) =>
        `${((i / (data.length - 1)) * w).toFixed(1)},${(
          h -
          3 -
          ((v - min) / range) * (h - 6)
        ).toFixed(1)}`
    )
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("h-7 w-full", className)}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "var(--terminal-green)" : "var(--terminal-amber)"}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Static, realistic demo data for the design-system gallery.
 *  Not connected to any API — Phase 1 visual scaffolding only. */

export type AdStatus = "active" | "review" | "paused" | "draft";

export const adRows = [
  {
    name: "SP — Search Exact",
    campaign: "Q3 Retargeting",
    channel: "Google Ads",
    spend: "$12,480",
    ctr: "4.82%",
    status: "active" as AdStatus,
    trend: [12, 14, 13, 16, 18, 17, 21, 23, 22, 26],
  },
  {
    name: "Performance Max — Catalog",
    campaign: "Always-On Prospecting",
    channel: "Meta",
    spend: "$8,910",
    ctr: "3.15%",
    status: "active" as AdStatus,
    trend: [18, 17, 19, 18, 20, 21, 20, 22, 23, 24],
  },
  {
    name: "Display — Affinity",
    campaign: "Brand Awareness",
    channel: "LinkedIn",
    spend: "$4,220",
    ctr: "1.04%",
    status: "review" as AdStatus,
    trend: [9, 8, 10, 7, 9, 8, 10, 9, 11, 10],
  },
  {
    name: "Video — 15s Pre-roll",
    campaign: "Product Launch",
    channel: "YouTube",
    spend: "$21,300",
    ctr: "2.67%",
    status: "paused" as AdStatus,
    trend: [22, 21, 19, 20, 18, 17, 15, 14, 13, 12],
  },
  {
    name: "Shopping — Standard Feed",
    campaign: "Always-On Prospecting",
    channel: "Google Ads",
    spend: "$6,745",
    ctr: "3.90%",
    status: "draft" as AdStatus,
    trend: [5, 6, 6, 7, 8, 8, 9, 9, 10, 11],
  },
];

export const statusMeta: Record<
  AdStatus,
  { label: string; dot: string; chip: string }
> = {
  active: {
    label: "active",
    dot: "bg-terminal-green",
    chip: "border-terminal-green/40 bg-terminal-green-soft text-terminal-green",
  },
  review: {
    label: "review",
    dot: "bg-terminal-amber",
    chip: "border-terminal-amber/40 bg-terminal-amber-soft text-terminal-amber",
  },
  paused: {
    label: "paused",
    dot: "bg-muted-foreground",
    chip: "border-border bg-muted text-muted-foreground",
  },
  draft: {
    label: "draft",
    dot: "bg-transparent ring-1 ring-input",
    chip: "border-border bg-transparent text-muted-foreground",
  },
};

export const metricCards = [
  {
    id: "spend",
    label: "TOTAL SPEND",
    value: "$53,655",
    delta: "+8.2%",
    up: true,
    sub: "vs. prev. 30d",
    spark: [12, 14, 13, 16, 18, 17, 21, 23, 22, 26],
  },
  {
    id: "ctr",
    label: "AVG CTR",
    value: "3.42%",
    delta: "+0.4pt",
    up: true,
    sub: "target 3.0%",
    spark: [8, 9, 9, 11, 10, 12, 12, 13, 14, 15],
  },
  {
    id: "conv",
    label: "CONVERSIONS",
    value: "1,284",
    delta: "−2.1%",
    up: false,
    sub: "412 pending",
    spark: [20, 19, 20, 18, 17, 18, 16, 15, 16, 14],
  },
  {
    id: "roas",
    label: "ROAS",
    value: "3.8x",
    delta: "+0.2x",
    up: true,
    sub: "goal 3.5x",
    spark: [10, 11, 11, 12, 13, 12, 14, 14, 15, 16],
  },
];

export const activity = [
  {
    time: "09:41",
    who: "SYSTEM",
    what: "Google Ads sync completed",
    detail: "4 campaigns, 0 conflicts",
    tone: "ok" as const,
  },
  {
    time: "09:12",
    who: "ops@nord",
    what: "Approved AI budget shift",
    detail: "+$1,200 → SP Search Exact",
    tone: "ok" as const,
  },
  {
    time: "08:57",
    who: "SYSTEM",
    what: "Meta token expires in 5 days",
    detail: "Reconnect to keep syncing",
    tone: "warn" as const,
  },
  {
    time: "08:30",
    who: "AI · agent-03",
    what: "Drafted 6 ad variants",
    detail: "Awaiting human approval",
    tone: "pending" as const,
  },
  {
    time: "07:58",
    who: "SYSTEM",
    what: "LinkedIn sync failed",
    detail: "429 rate limit — retrying 10:00",
    tone: "err" as const,
  },
];

export const integrations = [
  { name: "Google Ads", status: "connected", detail: "sync 15m · read/write" },
  { name: "Meta Ads", status: "connected", detail: "sync 1h · read" },
  { name: "LinkedIn Ads", status: "error", detail: "429 · retrying 10:00" },
  { name: "TikTok Ads", status: "available", detail: "not connected" },
];
