import { useState } from "react";
import { Link, NavLink } from "react-router";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpRight,
  Blocks,
  ChevronDown,
  Megaphone,
  PenTool,
  Plus,
  Route,
  Search,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { moduleTileBg, moduleTileChip, moduleTileText } from "@/components/mosaic";
import { MOSAI_EASE, MOTION } from "@/components/motion";
import { capabilityStateLabel } from "@/hooks/use-module-entitlements";
import type { CapabilityState } from "@/convex/lib/capabilities";
import { cn } from "@/lib/utils";

/**
 * The module list shown in the app shell (desktop sidebar and mobile sheet).
 *
 * The order is the registry order (`MODULE_IDS` in `convex/lib/capabilities`);
 * each module wears its mosaic tile colour. Which modules appear where is
 * decided only by the server's capability state (`entitlements.matrix`) —
 * nothing here unlocks a module. Picking a module the caller does not have
 * goes to billing, which is where the server decides.
 */
export const NAV_MODULES = [
  { to: "understand", label: "Understand", description: "Organize project facts and customer personas.", icon: Search },
  { to: "journeys", label: "Journeys", description: "Map the steps customers take to reach their goals.", icon: Route },
  { to: "create", label: "Create", description: "Find content gaps, research topics and write content.", icon: PenTool },
  { to: "build", label: "Build", description: "Plan and create websites and apps for your project.", icon: Blocks },
  { to: "customers", label: "Customers", description: "Manage customer relationships and follow-ups.", icon: Users },
  { to: "promote", label: "Promote", description: "Prepare campaigns and social posts for review.", icon: Megaphone },
  { to: "sell", label: "Sell", description: "Manage products, storefront content and feeds.", icon: ShoppingBag },
  { to: "grow", label: "Grow", description: "Connect data sources and review performance insights.", icon: TrendingUp },
] as const;

export type NavModule = (typeof NAV_MODULES)[number];

/** Where a module belongs in the navigation, from its server-resolved state. */
export type ModuleNavBucket =
  | "included"
  | "needs_setup"
  | "addable"
  | "unavailable"
  | "unknown";

export function moduleNavBucket(state: CapabilityState | null): ModuleNavBucket {
  switch (state) {
    case "included":
      return "included";
    case "needs_setup":
      return "needs_setup";
    case "locked":
      return "addable";
    case "unavailable":
      return "unavailable";
    default:
      // No state from the server yet (or a module the matrix did not list):
      // never offer it, in either list.
      return "unknown";
  }
}

export interface ModuleNavPartition<T> {
  /** Modules the caller owns (included + needs setup), in registry order. */
  primary: T[];
  included: T[];
  needsSetup: T[];
  /** `locked` — can be added through billing. */
  addable: T[];
  /** `unavailable` — cannot be bought here; shown for honesty only. */
  unavailable: T[];
  /** No server state yet. */
  unknown: T[];
}

/**
 * Pure partition of the module list by capability state. Every bucket keeps
 * the input order, so the sidebar never reshuffles as states resolve.
 */
export function partitionModules<T extends { readonly to: string }>(
  modules: readonly T[],
  stateOf: (module: string) => CapabilityState | null,
): ModuleNavPartition<T> {
  const result: ModuleNavPartition<T> = {
    primary: [],
    included: [],
    needsSetup: [],
    addable: [],
    unavailable: [],
    unknown: [],
  };
  for (const module of modules) {
    const bucket = moduleNavBucket(stateOf(module.to));
    switch (bucket) {
      case "included":
        result.included.push(module);
        result.primary.push(module);
        break;
      case "needs_setup":
        result.needsSetup.push(module);
        result.primary.push(module);
        break;
      case "addable":
        result.addable.push(module);
        break;
      case "unavailable":
        result.unavailable.push(module);
        break;
      case "unknown":
        result.unknown.push(module);
        break;
    }
  }
  return result;
}

/** The "select a new module" destination. Billing decides; nothing unlocks here. */
export function addModuleHref(moduleId: string): string {
  return `/app/billing?module=${encodeURIComponent(moduleId)}`;
}

/** Per-user localStorage key for the "Add a module" section's open state. */
export function addModuleStorageKey(userId: string | null | undefined): string {
  return `mosai:module-nav:add-open:${userId ?? "anonymous"}`;
}

function readStoredOpen(key: string): boolean | null {
  try {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(key);
    if (value === "1") return true;
    if (value === "0") return false;
    return null;
  } catch {
    return null;
  }
}

function writeStoredOpen(key: string, open: boolean): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, open ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, blocked site data): the section
    // still works, it just will not remember its state.
  }
}

type Variant = "desktop" | "mobile";

export function ModuleNav({
  variant,
  projectId,
  loading,
  stateOf,
  userId,
  onNavigate,
}: {
  variant: Variant;
  /** The project module links point into; without one, owned modules render inert. */
  projectId?: string;
  loading: boolean;
  stateOf: (module: string) => CapabilityState | null;
  userId?: string | null;
  /** Called after any link in the list is chosen (the mobile sheet closes). */
  onNavigate?: () => void;
}) {
  const partition = partitionModules(NAV_MODULES, stateOf);
  const pending =
    loading || partition.unknown.length === NAV_MODULES.length;
  const storageKey = addModuleStorageKey(userId);
  const [storedOpen, setStoredOpen] = useState<boolean | null>(() =>
    readStoredOpen(storageKey),
  );
  const extras = [...partition.addable, ...partition.unavailable];
  const noneOwned = !pending && partition.primary.length === 0;
  const addOpen = storedOpen ?? noneOwned;
  const mobile = variant === "mobile";

  const heading = (
    <p className="px-2 pb-1.5 pt-3 font-mono text-caption uppercase tracking-wider text-muted-foreground">
      modules
    </p>
  );

  if (pending) {
    return (
      <div aria-busy="true">
        {heading}
        <span className="sr-only" role="status">
          Loading your modules
        </span>
        <ul className="space-y-1" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <li
              key={i}
              className={cn(
                "flex items-center gap-3 rounded-md px-2",
                mobile ? "min-h-11 py-2" : "py-2",
              )}
            >
              <Skeleton className="size-4 shrink-0 rounded-sm" />
              <span className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-2.5 w-full" />
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div>
      {heading}
      {noneOwned ? (
        <div className="mx-1 rounded-md border border-dashed bg-card/60 px-3 py-4 text-center">
          <p className="font-mono text-small font-medium">No modules yet</p>
          <p className="mt-1 text-caption leading-snug text-muted-foreground">
            Pick your first module from “Add a module” below.
          </p>
        </div>
      ) : (
        <ul className="space-y-0.5">
          {partition.primary.map((m) => (
            <li key={m.to}>
              <OwnedModuleLink
                module={m}
                variant={variant}
                projectId={projectId}
                needsSetup={partition.needsSetup.includes(m)}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      )}

      {extras.length > 0 && (
        <Collapsible
          open={addOpen}
          onOpenChange={(open) => {
            setStoredOpen(open);
            writeStoredOpen(storageKey, open);
          }}
          className="mt-3 border-t pt-2"
        >
          <CollapsibleTrigger
            className={cn(
              "group/add flex w-full items-center gap-2 rounded-md px-2 text-left font-mono text-small text-muted-foreground ease-terminal hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mobile ? "min-h-11 py-2" : "py-1.5",
            )}
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-sm border border-dashed text-terminal-green ease-terminal group-hover/add:border-solid">
              <Plus aria-hidden="true" className="size-3.5" />
            </span>
            <span className="flex-1">
              Add a module{" "}
              <span className="text-caption tabular-nums">({extras.length})</span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform duration-200 ease-mosaic group-data-[state=open]/add:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
            <ul className="space-y-1 pb-1 pt-1.5">
              {partition.addable.map((m) => (
                <li key={m.to}>
                  <Link
                    to={addModuleHref(m.to)}
                    onClick={onNavigate}
                    className={cn(
                      "group/extra flex items-start gap-3 rounded-md border border-transparent px-2 py-2 ease-terminal hover:border-border hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      mobile && "min-h-11",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm",
                        moduleTileChip(m.to),
                      )}
                    >
                      <m.icon aria-hidden="true" className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-mono text-small">
                        {m.label}
                        <ArrowUpRight
                          aria-hidden="true"
                          className="size-3.5 text-muted-foreground opacity-0 ease-terminal group-hover/extra:opacity-100 group-focus-visible/extra:opacity-100"
                        />
                      </span>
                      <span className="block text-caption leading-snug text-muted-foreground">
                        {m.description}
                      </span>
                      <span className="mt-1 block font-mono text-caption text-terminal-amber">
                        Not included yet · {capabilityStateLabel("locked")} to add
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {partition.unavailable.map((m) => (
                <li
                  key={m.to}
                  className="flex items-start gap-3 rounded-md border border-dashed px-2 py-2 opacity-70"
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-sm bg-muted text-muted-foreground">
                    <m.icon aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-small text-muted-foreground">
                      {m.label}
                    </span>
                    <span className="block text-caption leading-snug text-muted-foreground">
                      {m.description}
                    </span>
                    <span className="mt-1 block font-mono text-caption text-muted-foreground">
                      {capabilityStateLabel("unavailable")} · not offered in your country yet
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function OwnedModuleLink({
  module: m,
  variant,
  projectId,
  needsSetup,
  onNavigate,
}: {
  module: NavModule;
  variant: Variant;
  projectId?: string;
  needsSetup: boolean;
  onNavigate?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const mobile = variant === "mobile";
  const rowClass = cn(
    "group/nav relative flex items-center gap-3 rounded-md px-2 font-mono text-small",
    mobile ? "min-h-11 py-2" : "py-1.5",
  );

  const body = (active: boolean) => (
    <>
      {active && (
        <motion.span
          layoutId={`module-nav-active-${variant}`}
          aria-hidden="true"
          className="absolute inset-0 rounded-md bg-accent shadow-card"
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: MOTION.slow, ease: MOSAI_EASE }
          }
        >
          <span
            className={cn(
              "absolute inset-y-2 left-0 w-0.5 rounded-full",
              moduleTileBg(m.to),
            )}
          />
        </motion.span>
      )}
      <m.icon
        aria-hidden="true"
        className={cn(
          "relative size-4 shrink-0 transition-transform duration-300 ease-mosaic motion-reduce:transition-none",
          projectId ? moduleTileText(m.to) : "text-muted-foreground",
          projectId && "group-hover/nav:-rotate-6 group-hover/nav:scale-110",
        )}
      />
      <span className="relative min-w-0 flex-1">
        <span className={cn("flex items-center gap-1.5", active && "font-medium")}>
          {m.label}
          {needsSetup && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-terminal-amber"
              title="Needs setup"
              aria-hidden="true"
            />
          )}
          {needsSetup && (
            <span className="sr-only">({capabilityStateLabel("needs_setup")})</span>
          )}
        </span>
        <span className="block whitespace-normal font-sans text-caption leading-snug text-muted-foreground">
          {needsSetup ? "Finish setup to start using this module." : m.description}
        </span>
      </span>
    </>
  );

  if (!projectId) {
    return (
      <div className={cn(rowClass, "text-muted-foreground")}>{body(false)}</div>
    );
  }

  return (
    <NavLink
      to={`/app/${projectId}/${m.to}`}
      onClick={onNavigate}
      className={cn(
        rowClass,
        "ease-terminal hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {({ isActive }) => body(isActive)}
    </NavLink>
  );
}
