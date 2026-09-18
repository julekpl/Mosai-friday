import type { ComponentType, ReactNode } from "react";
import { useParams, Navigate } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/app/AppShell";
import Overview from "./app/Overview";
import Understand from "./app/Understand";
import Create from "./app/Create";
import Build from "./app/Build";
import Customers from "./app/Customers";
import Promote from "./app/Promote";
import Sell from "./app/Sell";
import Grow from "./app/Grow";

/** Module dispatch table — module ids match PLAN_MODULES keys in billing.ts. */
const MODULES: Record<
  string,
  ComponentType<{ projectId: Id<"projects"> }>
> = {
  understand: Understand,
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
  const billing = useQuery(api.billing.currentPlan);
  if (!projectId) return <Navigate to="/dashboard" replace />;
  return <Overview projectId={projectId as Id<"projects">} modules={billing?.modules ?? []} />;
}

export function ModuleRouter() {
  const { projectId, module } = useParams<{ projectId: string; module: string }>();
  const billing = useQuery(api.billing.currentPlan);

  if (!projectId || !module) return <Navigate to="/dashboard" replace />;

  const Component = MODULES[module];
  if (!Component) return <Navigate to={`/app/${projectId}`} replace />;

  // Plan gate: modules not in the entitlement list go to billing.
  if (billing && !billing.modules.includes(module)) {
    return <Navigate to="/app/billing" replace />;
  }

  return <Component projectId={projectId as Id<"projects">} />;
}
