import { Link } from "react-router";
import { motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  Blocks,
  LockKeyhole,
  Megaphone,
  PenTool,
  Route,
  Search,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";

import type { Id } from "@/convex/_generated/dataModel";
import type { CapabilityState } from "@/convex/lib/capabilities";
import { MODULE_TILES, type TileName } from "@/components/mosaic";
import { MOSAI_EASE, MOTION } from "@/components/motion";
import { ModuleEmpty } from "@/components/app/module-kit";
import { Button } from "@/components/ui/button";
import { capabilityStateLabel } from "@/hooks/use-module-entitlements";
import { cn } from "@/lib/utils";

/**
 * "Your tools": the module cards on the project home, shown below the
 * "This week" next step (U6). Extracted from Overview.tsx unchanged apart
 * from a smaller card size.
 */
/* ── Presentation tables ────────────────────────────────────────────────── */

/** Presentation only (icon, copy). Whether a module is unlocked is decided by
 *  the server's capability matrix, never by a tier column here. */
const MODULE_CARDS = [
  { to: "understand", icon: Search, name: "Understand", desc: "Who your customers are and what they need" },
  { to: "journeys", icon: Route, name: "Journeys", desc: "How people go from hearing about you to buying" },
  { to: "create", icon: PenTool, name: "Create", desc: "Posts, articles and emails, written with AI" },
  { to: "build", icon: Blocks, name: "Build", desc: "Your website or app, made from your business details" },
  { to: "customers", icon: Users, name: "Customers", desc: "Your contacts, who agreed to hear from you, and follow-ups" },
  { to: "promote", icon: Megaphone, name: "Promote", desc: "Social posts, campaigns and ads" },
  { to: "sell", icon: ShoppingBag, name: "Sell", desc: "Your products, ready for your site and ads" },
  { to: "grow", icon: TrendingUp, name: "Grow", desc: "What is working, with where each number came from" },
] as const;

export type ModuleCardId = (typeof MODULE_CARDS)[number]["to"];

/** Static class sets per tile so Tailwind can see every class. `ink` is the
 *  AA-safe text/icon tone; `solid` is decoration only. */
const TILE_CLASSES: Record<TileName, { soft: string; ink: string; solid: string; hoverBorder: string }> = {
  teal: { soft: "bg-tile-teal-soft", ink: "text-tile-teal-ink", solid: "bg-tile-teal", hoverBorder: "hover:border-tile-teal/60" },
  coral: { soft: "bg-tile-coral-soft", ink: "text-tile-coral-ink", solid: "bg-tile-coral", hoverBorder: "hover:border-tile-coral/60" },
  violet: { soft: "bg-tile-violet-soft", ink: "text-tile-violet-ink", solid: "bg-tile-violet", hoverBorder: "hover:border-tile-violet/60" },
  sky: { soft: "bg-tile-sky-soft", ink: "text-tile-sky-ink", solid: "bg-tile-sky", hoverBorder: "hover:border-tile-sky/60" },
  rose: { soft: "bg-tile-rose-soft", ink: "text-tile-rose-ink", solid: "bg-tile-rose", hoverBorder: "hover:border-tile-rose/60" },
  lime: { soft: "bg-tile-lime-soft", ink: "text-tile-lime-ink", solid: "bg-tile-lime", hoverBorder: "hover:border-tile-lime/60" },
  amber: { soft: "bg-tile-amber-soft", ink: "text-tile-amber-ink", solid: "bg-tile-amber", hoverBorder: "hover:border-tile-amber/60" },
};

function tileFor(moduleId: ModuleCardId) {
  return TILE_CLASSES[MODULE_TILES[moduleId]];
}

const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

const riseIn: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: MOTION.slow, ease: MOSAI_EASE } },
};

/* ── Module grid ────────────────────────────────────────────────────────── */

function ModuleCard({
  card,
  projectId,
  state,
  savedLabel,
}: {
  card: (typeof MODULE_CARDS)[number];
  projectId: Id<"projects">;
  state: CapabilityState;
  savedLabel?: string;
}) {
  const tile = tileFor(card.to);
  const Icon = card.icon;
  const included = state === "included";
  const unavailable = state === "unavailable";
  // Locked modules go straight to plan options; needs_setup opens the
  // module (the route gate decides); unavailable is not a link at all.
  const to = included ? `/app/${projectId}/${card.to}` : state === "locked" ? "/app/billing" : `/app/${projectId}/${card.to}`;

  const body = (
    <>
      {/* Tile band + decorative corner mosaic */}
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-1", tile.solid, !included && "opacity-40")} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-4 top-5 grid grid-cols-2 gap-1 opacity-30 transition-transform duration-300 ease-mosaic group-hover:-translate-x-1 group-hover:translate-y-1 group-hover:rotate-6"
      >
        <span className={cn("size-3 rounded-xs", tile.solid)} />
        <span className={cn("size-3 rounded-xs", tile.solid)} />
        <span className="size-3" />
        <span className={cn("size-3 rounded-xs", tile.solid)} />
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "grid size-9 place-items-center rounded-lg transition-transform duration-300 ease-mosaic group-hover:-rotate-6 group-hover:scale-105",
          included ? [tile.soft, tile.ink] : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" />
      </span>
      <h3 className="mt-3 font-mono text-small font-semibold">{card.name}</h3>
      <p className="mt-1 font-mono text-caption text-muted-foreground">{card.desc}</p>

      <span className="mt-auto flex items-center gap-2 pt-3 font-mono text-caption">
        {included ? (
          <>
            <span className={cn("font-medium", tile.ink)}>{savedLabel ?? "Open"}</span>
            <ArrowRight
              aria-hidden="true"
              className={cn("ml-auto size-4 transition-transform duration-200 ease-terminal group-hover:translate-x-1", tile.ink)}
            />
          </>
        ) : (
          <>
            <LockKeyhole aria-hidden="true" className="size-3.5 text-terminal-amber-ink" />
            <span className="text-muted-foreground">
              {state === "locked" ? "Not on your plan · see options" : capabilityStateLabel(state)}
            </span>
          </>
        )}
      </span>
    </>
  );

  const shell = "group relative flex h-full min-h-32 flex-col overflow-hidden rounded-lg border bg-card p-4 shadow-soft";

  if (unavailable) {
    return (
      <div className={cn(shell, "opacity-90")} aria-label={`${card.name} — unavailable`}>
        {body}
      </div>
    );
  }

  return (
    <Link
      to={to}
      aria-label={
        included
          ? `Open ${card.name}${savedLabel ? ` — ${savedLabel}` : ""}`
          : `${card.name} — ${capabilityStateLabel(state)}${state === "locked" ? ", view plan options" : ""}`
      }
      className={cn(shell, "hover-lift focus-ring", included && tile.hoverBorder)}
    >
      {body}
    </Link>
  );
}

function ModuleGridSkeleton() {
  return (
    <div role="status" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <span className="sr-only">Loading your modules…</span>
      {MODULE_CARDS.map((m) => (
        <div key={m.to} aria-hidden="true" className="h-32 animate-pulse rounded-lg border bg-card shadow-soft" />
      ))}
    </div>
  );
}

export function ModuleGrid({
  projectId,
  modules,
  loading,
  stateOf,
  counts,
}: {
  projectId: Id<"projects">;
  modules: string[];
  loading: boolean;
  stateOf: (module: string) => CapabilityState | null;
  counts: Partial<Record<ModuleCardId, string>>;
}) {
  if (loading) return <ModuleGridSkeleton />;

  const stateFor = (id: string): CapabilityState =>
    modules.includes(id) ? "included" : (stateOf(id) ?? "locked");

  if (MODULE_CARDS.every((m) => stateFor(m.to) !== "included")) {
    return (
      <ModuleEmpty
        icon={LockKeyhole}
        title="No modules are included on your plan yet"
        hint="Your project details are saved. Choose a plan to unlock Understand, Create, Build and the rest."
        action={
          <Button asChild>
            <Link to="/app/billing">
              View plan options <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <motion.ul
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {MODULE_CARDS.map((card) => (
        <motion.li key={card.to} variants={riseIn} className="min-w-0">
          <ModuleCard
            card={card}
            projectId={projectId}
            state={stateFor(card.to)}
            savedLabel={counts[card.to]}
          />
        </motion.li>
      ))}
    </motion.ul>
  );
}
