import { useEffect, useRef, type ComponentType, type ReactNode } from "react";
import { useParams, Navigate } from "react-router";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app/AppShell";
import { useModuleEntitlements } from "@/hooks/use-module-entitlements";
import Overview from "./app/Overview";
import Understand from "./app/Understand";
import Journeys from "./app/Journeys";
import Create from "./app/Create";
import Build from "./app/Build";
import Customers from "./app/Customers";
import Promote from "./app/Promote";
import Sell from "./app/Sell";
import Grow from "./app/Grow";

/** Module dispatch table — module ids are the capability registry's ids
 *  (`src/convex/lib/capabilities.ts`), the same ones the guards and the
 *  entitlements query speak. */
const MODULES: Record<
  string,
  ComponentType<{ projectId: Id<"projects"> }>
> = {
  understand: Understand,
  journeys: Journeys,
  create: Create,
  build: Build,
  customers: Customers,
  promote: Promote,
  sell: Sell,
  grow: Grow,
};

/** AppShell wrapper that reads the projectId route param. */
export function AppShellWithProject({ children }: { children: ReactNode }) {
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <AppShell projectId={projectId as Id<"projects"> | undefined}>
      {children}
    </AppShell>
  );
}

export default function AppHome() {
  const { projectId } = useParams<{ projectId: string }>();
  const entitlements = useModuleEntitlements(projectId as Id<"projects"> | undefined);
  if (!projectId) return <Navigate to="/dashboard" replace />;
  return (
    <Overview
      projectId={projectId as Id<"projects">}
      modules={entitlements.included}
    />
  );
}

/** Renders one module with the shared route transition and heading focus.
 *  On a module switch, focus moves to the new page's <h1> so keyboard and
 *  screen-reader users land where the content changed; a direct page load
 *  leaves focus alone. */
function ModuleView({
  module,
  projectId,
}: {
  module: string;
  projectId: Id<"projects">;
}) {
  const Component = MODULES[module];
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedOnce = useRef(false);

  useEffect(() => {
    if (!mountedOnce.current) {
      mountedOnce.current = true;
      return;
    }
    const heading = containerRef.current?.querySelector("h1");
    if (heading instanceof HTMLElement) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  }, [module]);

  if (!Component) return null;
  return (
    <div ref={containerRef}>
      {/* AppShell animates route changes (reduced-motion aware). */}
      <Component key={module} projectId={projectId} />
    </div>
  );
}

export function ModuleRouter() {
  const { projectId, module } = useParams<{ projectId: string; module: string }>();
  // The route gate reads the same server resolution the guards enforce
  // (organization plan × caller role), so disabling an add-on changes the
  // route, the nav, the queries and the mutations together. A non-`included`
  // state (today always `locked`) sends the visitor to the plan screen rather
  // than rendering a module the server would refuse.
  const entitlements = useModuleEntitlements(projectId as Id<"projects"> | undefined);

  if (!projectId || !module) return <Navigate to="/dashboard" replace />;

  const state = entitlements.stateOf(module);
  if (state !== null && state !== "included") {
    return <Navigate to="/app/billing" replace />;
  }
  if (!MODULES[module]) return <Navigate to={`/app/${projectId}`} replace />;

  return <ModuleView module={module} projectId={projectId as Id<"projects">} />;
}
