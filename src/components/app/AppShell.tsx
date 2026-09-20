import { Fragment, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NavLink, useNavigate } from "react-router";
import {
  Bot,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  Megaphone,
  PenTool,
  Plus,
  Route,
  Search,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
  Blocks,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { MosaicMark, moduleTileBg, moduleTileText } from "@/components/mosaic";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const modules = [
  { to: "understand", label: "Understand", icon: Search },
  { to: "journeys", label: "Journeys", icon: Route },
  { to: "create", label: "Create", icon: PenTool },
  { to: "build", label: "Build", icon: Blocks },
  { to: "customers", label: "Customers", icon: Users },
  { to: "promote", label: "Promote", icon: Megaphone },
  { to: "sell", label: "Sell", icon: ShoppingBag },
  { to: "grow", label: "Grow", icon: TrendingUp },
] as const;

export function AppShell({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId?: Id<"projects">;
}) {
  const { user, signOut } = useAuth();
  const projects = useQuery(api.projects.list) ?? [];
  const navigate = useNavigate();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const current = projects.find((p) => p._id === projectId) ?? projects[0];
  // Entitlements come from the server (billing.currentPlan → PLAN_MODULES).
  // The client never hardcodes plan tiers, so the UI cannot show a module
  // the server would refuse (blueprint: one capability registry).
  const billing = useQuery(api.billing.currentPlan);
  const plan = billing?.plan ?? "free";
  const unlockedModules = billing?.modules;

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <MosaicMark size={22} interactive />
          <span className="font-mono text-small font-semibold">mosai</span>
          <Badge variant="outline" className="ml-auto font-mono text-caption">
            {plan}
          </Badge>
        </div>

        {/* Workspace / project switcher */}
        <div className="border-b p-2">
          <Popover open={switcherOpen} onOpenChange={setSwitcherOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between px-2 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-small font-medium">
                    {current ? current.name : "No project"}
                  </span>
                  <span className="block font-mono text-caption text-muted-foreground">
                    workspace
                  </span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 p-1">
              {projects.length === 0 && (
                <p className="px-2 py-3 font-mono text-caption text-muted-foreground">
                  No projects yet — create one to begin.
                </p>
              )}
              {projects.map((p) => (
                <button
                  key={p._id}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-small hover:bg-accent ease-terminal",
                    current?._id === p._id && "bg-accent",
                  )}
                  onClick={() => {
                    setSwitcherOpen(false);
                    navigate(`/app/${p._id}`);
                  }}
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-terminal-green" />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
              <Separator className="my-1" />
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-small hover:bg-accent ease-terminal"
                onClick={() => {
                  setSwitcherOpen(false);
                  navigate("/app/new");
                }}
              >
                <Plus className="size-3.5 text-terminal-green" />
                New project
              </button>
            </PopoverContent>
          </Popover>
        </div>

        {/* Module nav — each module wears its mosaic tile colour */}
        <nav className="flex-1 overflow-y-auto p-2">
          <p className="px-2 pb-1 pt-2 font-mono text-caption text-muted-foreground">
            modules
          </p>
          {modules.map((m) => {
            // While the entitlement query is loading, render without locks.
            const locked = unlockedModules
              ? !unlockedModules.includes(m.to)
              : false;
            const inner = (
              <>
                <m.icon
                  className={cn(
                    "size-4 shrink-0 transition-transform duration-300 ease-mosaic",
                    locked
                      ? "text-muted-foreground/50"
                      : cn(
                          moduleTileText(m.to),
                          "group-hover/nav:scale-110 group-hover/nav:-rotate-6",
                        ),
                  )}
                />
                <span className={cn(locked && "text-muted-foreground/50")}>
                  {m.label}
                </span>
                {locked && (
                  <Badge
                    variant="outline"
                    className="ml-auto font-mono text-caption text-terminal-amber"
                  >
                    upgrade
                  </Badge>
                )}
              </>
            );
            return current ? (
              <NavLink
                key={m.to}
                to={locked ? "/app/billing" : `/app/${current._id}/${m.to}`}
                className={({ isActive }) =>
                  cn(
                    "group/nav relative mb-0.5 flex items-center gap-2 rounded-sm px-2 py-1.5 font-mono text-small ease-terminal hover:bg-accent",
                    isActive && "bg-accent font-medium",
                  )
                }
              >
                {({ isActive }) => (
                  <Fragment>
                    {/* Active tile dot + slide-in marker */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-1/2 h-[60%] w-[3px] -translate-y-1/2 rounded-full transition-all duration-300 ease-mosaic",
                        isActive ? "scale-y-100 opacity-100" : "scale-y-0 opacity-0",
                        isActive ? moduleTileBg(m.to) : "",
                      )}
                    />
                    {inner}
                  </Fragment>
                )}
              </NavLink>
            ) : (
              <div
                key={m.to}
                className="mb-0.5 flex items-center gap-2 rounded-sm px-2 py-1.5 font-mono text-small text-muted-foreground/50"
              >
                {inner}
              </div>
            );
          })}
        </nav>

        {/* Account */}
        <div className="border-t p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-auto w-full justify-start gap-2 px-2 py-2">
                <Avatar className="size-7">
                  <AvatarFallback className="font-mono text-caption">
                    {(user?.name ?? user?.email ?? "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 text-left">
                  <span className="block truncate font-mono text-caption">
                    {user?.email ?? "operator"}
                  </span>
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="font-mono text-caption">
                Account
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/app/billing")}>
                <Sparkles className="size-4" /> Plan &amp; billing
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={async () => {
                  await signOut();
                  navigate("/");
                }}
              >
                <LogOut className="size-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur lg:hidden">
        <MosaicMark size={20} />
        <span className="font-mono text-small font-semibold">mosai</span>
        <Button asChild size="sm" variant="outline" className="ml-auto h-7">
          <NavLink to={current ? `/app/${current._id}` : "/app/new"}>
            {current ? current.name : "New project"}
          </NavLink>
        </Button>
      </div>
      <div className="h-12 lg:hidden" />

      {/* Content */}
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</div>
      </main>
    </div>
  );
}

export function ModuleHeader({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="animate-mosaic-in mb-8 flex flex-wrap items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-card shadow-card transition-transform duration-300 ease-mosaic hover:rotate-6 hover:scale-110">
        <Icon className="size-5 text-terminal-green" />
      </span>
      <div className="min-w-0">
        <h1 className="font-mono text-h1">{title}</h1>
        {subtitle && (
          <p className="font-mono text-caption text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {children && <div className="ml-auto">{children}</div>}
    </header>
  );
}

export function EmptyModule({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <p className="font-mono text-small font-medium">{title}</p>
      <p className="mt-1 font-mono text-caption text-muted-foreground">{hint}</p>
    </div>
  );
}

// Re-export icons used by route pages so imports stay tidy.
export { LayoutDashboard, Bot as BotIcon };
