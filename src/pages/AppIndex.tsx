import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Link, useNavigate } from "react-router";
import { motion, type Variants } from "framer-motion";
import { ArrowRight, Compass, Plus, ScanSearch, Store } from "lucide-react";

import { FloatingTiles, MosaicMark } from "@/components/mosaic";
import { MOSAI_EASE, MOTION } from "@/components/motion";
import { ModuleErrorBoundary } from "@/components/app/module-kit";
import { Button } from "@/components/ui/button";
import { pickProjectToOpen, readLastProjectId } from "@/lib/last-project";

const FIRST_RUN_STEPS = [
  {
    icon: Store,
    title: "Name your workspace",
    detail: "Add your website or business listing if you have one.",
    tile: "bg-tile-teal-soft text-tile-teal-ink",
  },
  {
    icon: ScanSearch,
    title: "Review what we find",
    detail: "Every suggestion is a draft — keep, fix or skip it.",
    tile: "bg-tile-violet-soft text-tile-violet-ink",
  },
  {
    icon: Compass,
    title: "Tell us who you serve",
    detail: "Tap a few audiences and goals. Change them any time.",
    tile: "bg-tile-coral-soft text-tile-coral-ink",
  },
] as const;

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.12 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: MOTION.slow, ease: MOSAI_EASE } },
};

function OpeningWorkspace() {
  return (
    <div role="status" className="flex flex-col items-center gap-4 text-center">
      <MosaicMark size={40} />
      <p className="font-mono text-small text-muted-foreground">Opening your workspace…</p>
    </div>
  );
}

/** First run: no project yet. One friendly screen, one obvious next step. */
function FirstRunWelcome() {
  return (
    <motion.section
      aria-labelledby="welcome-title"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.slow, ease: MOSAI_EASE }}
      className="relative w-full max-w-2xl overflow-hidden rounded-xl border bg-hero-wash p-6 shadow-lift sm:p-10"
    >
      <MosaicMark size={40} />
      <p className="mt-6 font-mono text-small text-muted-foreground">Welcome to MOSAI</p>
      <h1 id="welcome-title" className="mt-1 font-mono text-h1 sm:text-display">
        Let’s set up your first workspace.
      </h1>
      <p className="mt-4 max-w-prose font-mono text-small text-muted-foreground">
        A workspace holds one business: who it serves, what it offers and what
        you create for it. Three short steps and you’re in.
      </p>

      <motion.ol variants={list} initial="hidden" animate="show" className="mt-8 grid gap-3">
        {FIRST_RUN_STEPS.map((step, index) => (
          <motion.li
            key={step.title}
            variants={item}
            className="flex items-start gap-4 rounded-lg border bg-card p-4 shadow-soft"
          >
            <span aria-hidden="true" className={`grid size-10 shrink-0 place-items-center rounded-lg ${step.tile}`}>
              <step.icon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-small font-semibold">
                <span className="text-muted-foreground">{index + 1}. </span>
                {step.title}
              </span>
              <span className="mt-0.5 block font-mono text-caption text-muted-foreground">{step.detail}</span>
            </span>
          </motion.li>
        ))}
      </motion.ol>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button asChild size="lg" className="group w-full sm:w-auto">
          <Link to="/app/new">
            Set up my workspace
            <ArrowRight
              aria-hidden="true"
              className="size-4 transition-transform duration-200 ease-terminal group-hover:translate-x-0.5"
            />
          </Link>
        </Button>
        <p className="font-mono text-caption text-muted-foreground">
          Nothing is published or connected until you say so.
        </p>
      </div>
    </motion.section>
  );
}

type ClientEntry = {
  projectId: string;
  projectName: string;
  clientName: string;
  updatedAt: number;
};

/** U9: an agency with several clients picks one; each is one click away. */
function ClientList({ clients }: { clients: readonly ClientEntry[] }) {
  return (
    <motion.section
      aria-labelledby="clients-title"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: MOTION.slow, ease: MOSAI_EASE }}
      className="relative w-full max-w-2xl rounded-xl border bg-card p-4 shadow-lift sm:p-8"
    >
      <MosaicMark size={32} />
      <h1 id="clients-title" className="mt-4 font-mono text-h1">Your clients</h1>
      <p className="mt-2 font-mono text-caption text-muted-foreground">
        Pick a client to open their marketing. Most recent first.
      </p>
      <ul className="mt-6 grid gap-2">
        {clients.map((client) => (
          <li key={client.projectId}>
            <Link
              to={`/app/${client.projectId}`}
              className="group flex min-h-11 items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3 transition-colors ease-terminal hover:border-terminal-green/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="min-w-0">
                <span className="block break-words font-mono text-small font-semibold">{client.clientName}</span>
                {client.projectName !== client.clientName && (
                  <span className="mt-0.5 block break-words font-mono text-caption text-muted-foreground">{client.projectName}</span>
                )}
              </span>
              <ArrowRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-terminal group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
          <Link to="/app/new">
            <Plus aria-hidden="true" className="size-4" />
            Add a client
          </Link>
        </Button>
      </div>
    </motion.section>
  );
}

function AppIndexContent() {
  const navigate = useNavigate();
  const projects = useQuery(api.projects.list);
  const clientsResult = useQuery(api.projects.agencyClientProjects);
  // An agency with two or more clients chooses one; otherwise `/app` resumes
  // the last project as before. A missing answer counts as "no clients".
  const clients: readonly ClientEntry[] | undefined =
    clientsResult === undefined ? undefined : Array.isArray(clientsResult) ? clientsResult : [];
  const showClients = clients !== undefined && clients.length >= 2;
  const projectToOpen = projects && clients !== undefined && !showClients
    ? pickProjectToOpen(projects.map((p) => p._id), readLastProjectId())
    : undefined;

  // Returning users go straight back to the project they last used — no
  // extra click, and never an arbitrary one when they have several.
  useEffect(() => {
    if (projectToOpen) navigate(`/app/${projectToOpen}`, { replace: true });
  }, [projectToOpen, navigate]);

  if (projects === undefined || clients === undefined) return <OpeningWorkspace />;
  if (showClients) return <ClientList clients={clients} />;
  if (projects.length > 0) return <OpeningWorkspace />;
  return <FirstRunWelcome />;
}

export default function AppIndex() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12"
    >
      <FloatingTiles />
      <div className="relative flex w-full justify-center">
        <ModuleErrorBoundary>
          <AppIndexContent />
        </ModuleErrorBoundary>
      </div>
    </main>
  );
}
