import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  Bot,
  ChevronsUpDown,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { MosaicMark } from "@/components/mosaic";
import { MOSAI_EASE, MOTION } from "@/components/motion";
import { SkipLink } from "@/components/SkipLink";
import { useAuth } from "@/hooks/use-auth";
import { useModuleEntitlements } from "@/hooks/use-module-entitlements";
import { cn } from "@/lib/utils";
import { ConfirmDelete } from "@/components/app/module-kit";
import { ModuleNav, NAV_MODULES } from "@/components/app/ModuleNav";
import { toast } from "sonner";


export function AppShell({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId?: Id<"projects">;
}) {
  const { user, signOut } = useAuth();
  const admin = useQuery(api.admin.me);
  const projects = useQuery(api.projects.list) ?? [];
  const removeProject = useMutation(api.projects.remove);
  const navigate = useNavigate();
  const location = useLocation();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const reduceMotion = useReducedMotion();

  const current = projects.find((p) => p._id === projectId) ?? projects[0];
  // Entitlements come from the server, resolved for THIS project's
  // organization and the caller's role (`entitlements.matrix`, T2.3). The
  // client never hardcodes plan tiers or module lists, so the sidebar cannot
  // offer a module the guards would refuse — and cannot hide one the
  // organization has paid for.
  const entitlements = useModuleEntitlements(projectId);
  const plan = entitlements.plan ?? "free";
  const activeModule = NAV_MODULES.find((module) =>
    location.pathname.split("/").includes(module.to),
  );
  const currentLocation = location.pathname.endsWith("/billing")
    ? "Plan & billing"
    : location.pathname.endsWith("/new")
      ? "New project"
      : (activeModule?.label ?? "Overview");

  return (
    <div className="flex min-h-screen bg-background">
      <SkipLink />
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
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
                <div key={p._id} className={cn("flex items-center gap-1 rounded-sm px-1", current?._id === p._id && "bg-accent")}>
                  <button
                    className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left font-mono text-small hover:bg-accent ease-terminal"
                    onClick={() => {
                      setSwitcherOpen(false);
                      navigate(`/app/${p._id}`);
                    }}
                  >
                    <span className="size-1.5 shrink-0 rounded-full bg-terminal-green" />
                    <span className="truncate">{p.name}</span>
                  </button>
                  {p.ownerId === user?._id && (
                    <ConfirmDelete
                      what={`project “${p.name}”`}
                      description="MOSAI will queue this project and its saved data for deletion. This cannot be undone."
                      onConfirm={async () => {
                        await removeProject({ id: p._id });
                        toast.success("Project deletion queued", { description: "The project and its saved data will be removed." });
                        setSwitcherOpen(false);
                        if (current?._id === p._id) navigate("/dashboard");
                      }}
                      trigger={<Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Delete project ${p.name}`}><Trash2 className="size-3.5" /></Button>}
                    />
                  )}
                </div>
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

        {/* Module nav — owned modules first, everything else under "Add a module" */}
        <nav aria-label="Modules" className="flex-1 overflow-y-auto px-2 pb-3">
          {current ? (
            <>
              <NavLink
                to={`/app/${current._id}`}
                end
                className={({ isActive }) =>
                  cn(
                    "mb-0.5 flex items-center gap-2 rounded-sm px-2 py-1.5 font-mono text-small ease-terminal hover:bg-accent",
                    isActive && "bg-accent font-medium",
                  )
                }
              >
                <Home className="size-4 shrink-0 text-terminal-green" aria-hidden="true" />
                Home
              </NavLink>
              <NavLink
                to={`/app/${current._id}?edit=details`}
                className="mb-0.5 flex items-center gap-2 rounded-sm px-2 py-1.5 font-mono text-small text-muted-foreground ease-terminal hover:bg-accent hover:text-foreground"
              >
                <Settings2 className="size-4 shrink-0" aria-hidden="true" />
                Edit project
              </NavLink>
            </>
          ) : null}
          <ModuleNav
            variant="desktop"
            projectId={current?._id}
            loading={entitlements.loading}
            stateOf={entitlements.stateOf}
            userId={user?._id}
          />
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
              {admin?.isAdmin && (
                <DropdownMenuItem onClick={() => navigate("/admin")}>
                  <ShieldCheck className="size-4" /> Platform admin
                </DropdownMenuItem>
              )}
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
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 shrink-0"
              aria-label="Open navigation menu"
            >
              <Menu aria-hidden="true" className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-3/4 gap-0 overflow-y-auto p-0 sm:max-w-sm"
          >
            <SheetHeader className="border-b px-4 py-4 pr-12 text-left">
              <SheetTitle className="font-mono text-small">
                mosai navigation
              </SheetTitle>
              <SheetDescription className="font-mono text-caption">
                Current location: {currentLocation}
              </SheetDescription>
            </SheetHeader>
            <div className="border-b px-3 py-3">
              <p className="px-2 font-mono text-caption text-muted-foreground">
                workspace
              </p>
              {projects.map((project) => (
                <div key={project._id} className="mt-1 flex items-center gap-1">
                  <SheetClose asChild>
                    <NavLink
                      to={`/app/${project._id}`}
                      end
                      className={({ isActive }) => cn("block min-h-11 min-w-0 flex-1 truncate rounded-sm px-2 py-2 font-mono text-small hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", isActive && "bg-accent font-medium")}
                    >
                      {project.name}
                    </NavLink>
                  </SheetClose>
                  {project.ownerId === user?._id && (
                    <ConfirmDelete
                      what={`project “${project.name}”`}
                      description="MOSAI will queue this project and its saved data for deletion. This cannot be undone."
                      onConfirm={async () => {
                        await removeProject({ id: project._id });
                        toast.success("Project deletion queued", { description: "The project and its saved data will be removed." });
                        setMobileMenuOpen(false);
                        if (current?._id === project._id) navigate("/dashboard");
                      }}
                      trigger={<Button variant="ghost" size="icon" className="size-10 shrink-0 text-muted-foreground hover:text-destructive" aria-label={`Delete project ${project.name}`}><Trash2 className="size-4" /></Button>}
                    />
                  )}
                </div>
              ))}
              {current ? (
                <>
                  <SheetClose asChild>
                    <NavLink
                      to={`/app/${current._id}`}
                      end
                      className="mt-1 block min-h-11 truncate rounded-sm px-2 py-2 font-mono text-small hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Home
                    </NavLink>
                  </SheetClose>
                  <SheetClose asChild>
                    <NavLink
                      to={`/app/${current._id}?edit=details`}
                      className="block min-h-11 truncate rounded-sm px-2 py-2 font-mono text-small hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Edit project
                    </NavLink>
                  </SheetClose>
                </>
              ) : null}
              <SheetClose asChild>
                <NavLink
                  to="/app/new"
                  className="mt-1 block min-h-11 truncate rounded-sm px-2 py-2 font-mono text-small text-terminal-green hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  + New project
                </NavLink>
              </SheetClose>
              <p className="px-2 font-mono text-caption text-muted-foreground">
                {plan} plan
              </p>
            </div>
            <nav aria-label="Modules" className="flex-1 px-2 pb-3">
              <ModuleNav
                variant="mobile"
                projectId={current?._id}
                loading={entitlements.loading}
                stateOf={entitlements.stateOf}
                userId={user?._id}
                onNavigate={() => setMobileMenuOpen(false)}
              />
            </nav>
            <div className="border-t p-2">
              <p className="px-2 pb-1 pt-2 font-mono text-caption text-muted-foreground">
                account
              </p>
              <p className="truncate px-2 py-1 font-mono text-caption">
                {user?.email ?? "operator"}
              </p>
              <SheetClose asChild>
                <NavLink
                  to="/app/billing"
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-11 items-center gap-2 rounded-sm px-2 py-2 font-mono text-small hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive && "bg-accent font-medium",
                    )
                  }
                >
                  <Sparkles aria-hidden="true" className="size-4" />
                  Plan &amp; billing
                </NavLink>
              </SheetClose>
              {admin?.isAdmin && (
                <SheetClose asChild>
                  <NavLink
                    to="/admin"
                    className={({ isActive }) =>
                      cn(
                        "flex min-h-11 items-center gap-2 rounded-sm px-2 py-2 font-mono text-small hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive && "bg-accent font-medium",
                      )
                    }
                  >
                    <ShieldCheck aria-hidden="true" className="size-4" />
                    Platform admin
                  </NavLink>
                </SheetClose>
              )}
              <Button
                variant="ghost"
                className="min-h-11 w-full justify-start gap-2 px-2 font-mono text-small text-destructive"
                onClick={async () => {
                  setMobileMenuOpen(false);
                  await signOut();
                  navigate("/");
                }}
              >
                <LogOut aria-hidden="true" className="size-4" />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
        <MosaicMark size={20} />
        <span className="font-mono text-small font-semibold">mosai</span>
        <span className="sr-only" aria-live="polite">
          Current location: {currentLocation}
        </span>
        <Button asChild size="sm" variant="outline" className="ml-auto h-7 min-w-0 max-w-1/2 shrink">
          <NavLink to={current ? `/app/${current._id}` : "/app/new"}>
            <span className="truncate">{current ? current.name : "New project"}</span>
          </NavLink>
        </Button>
      </div>

      {/* Content */}
      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 pt-12 focus:outline-none lg:pt-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{
              duration: reduceMotion ? MOTION.fast : MOTION.base,
              ease: MOSAI_EASE,
            }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
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
        <h1 className="font-mono text-h1 tracking-tight">{title}</h1>
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
    <div className="animate-mosaic-in rounded-lg border border-dashed bg-card/40 px-6 py-12 text-center">
      <p className="font-mono text-small font-medium">{title}</p>
      <p className="mx-auto mt-1.5 max-w-prose font-mono text-caption text-muted-foreground">{hint}</p>
    </div>
  );
}

// Re-export icons used by route pages so imports stay tidy.
export { LayoutDashboard, Bot as BotIcon };
