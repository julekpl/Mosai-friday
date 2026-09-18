import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Link } from "react-router";
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  Megaphone,
  PenTool,
  Plus,
  Search,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import {
  DATA_PROVIDERS,
  ModuleEmpty,
} from "@/components/app/module-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const MODULE_CARDS = [
  {
    to: "understand",
    icon: Search,
    name: "Understand",
    desc: "Personas, buyer profiles, journeys and evidence",
    tier: null,
  },
  {
    to: "create",
    icon: PenTool,
    name: "Create",
    desc: "Gaps, topics, briefs and content generation",
    tier: null,
  },
  {
    to: "build",
    icon: Blocks,
    name: "Build",
    desc: "Websites & apps from personas, with SEO/WCAG checks",
    tier: "starter",
  },
  {
    to: "customers",
    icon: Users,
    name: "Customers",
    desc: "CRM, consent, segments — owned here, not by a vendor",
    tier: "starter",
  },
  {
    to: "promote",
    icon: Megaphone,
    name: "Promote",
    desc: "Campaigns, social scheduling, ads",
    tier: "starter",
  },
  {
    to: "sell",
    icon: ShoppingBag,
    name: "Sell",
    desc: "Products and product feeds for ads + website",
    tier: "growth",
  },
  {
    to: "grow",
    icon: TrendingUp,
    name: "Grow",
    desc: "Insights with source & freshness, no blended scores",
    tier: "scale",
  },
] as const;

export default function Overview({
  projectId,
  modules,
}: {
  projectId: Id<"projects">;
  modules: string[];
}) {
  const project = useQuery(api.projects.get, { id: projectId });
  const connections = useQuery(api.connections.list, { projectId }) ?? [];

  const connected = new Set(
    connections.filter((c) => c.status === "connected").map((c) => c.provider),
  );

  return (
    <div>
      <ModuleHeader
        icon={Search}
        title={project?.name ?? "Project"}
        subtitle={
          project?.description ??
          "The container for personas, content, connections and every module."
        }
      >
        <Badge variant="outline" className="font-mono text-caption">
          {project?.industry ?? "no industry set"}
        </Badge>
      </ModuleHeader>

      {/* Data connections */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-mono text-h3">Data connections</h2>
          <span className="font-mono text-caption text-muted-foreground">
            {connected.size}/{DATA_PROVIDERS.length} connected
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {DATA_PROVIDERS.map((p) => {
            const isConnected = connected.has(p.id);
            return (
              <span
                key={p.id}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-caption",
                  isConnected
                    ? "border-terminal-green/40 bg-terminal-green-soft text-terminal-green"
                    : "text-muted-foreground",
                )}
                title={p.detail}
              >
                {isConnected && <CheckCircle2 className="size-3.5" />}
                {p.label}
              </span>
            );
          })}
        </div>
        <p className="mt-2 font-mono text-caption text-muted-foreground">
          Connect GA4, Search Console and ad accounts in the Grow module — the
          same connections feed Promote, Customers and the builder.
        </p>
      </section>

      {/* Modules */}
      <section>
        <h2 className="mb-3 font-mono text-h3">Modules</h2>
        {modules.length === 0 ? (
          <ModuleEmpty
            icon={Blocks}
            title="No modules on your plan"
            hint="Upgrade in Plan & billing to unlock Build, Customers, Promote, Sell and Grow."
            action={
              <Button asChild>
                <Link to="/app/billing">View plans</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODULE_CARDS.map((m) => {
              const locked = m.tier !== null && !modules.includes(m.to);
              return (
                <Link
                  key={m.to}
                  to={locked ? "/app/billing" : `/app/${projectId}/${m.to}`}
                  className="group rounded-md border bg-card p-4 shadow-card ease-terminal transition-all hover:-translate-y-0.5 hover:border-terminal-green/50 hover:shadow-pop"
                >
                  <div className="flex items-center justify-between">
                    <m.icon className="size-5 text-terminal-green" />
                    {locked && (
                      <Badge variant="outline" className="font-mono text-caption text-terminal-amber">
                        upgrade
                      </Badge>
                    )}
                  </div>
                  <p className="mt-3 font-mono text-small font-medium">{m.name}</p>
                  <p className="mt-1 font-mono text-caption text-muted-foreground">
                    {m.desc}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
