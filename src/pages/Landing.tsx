import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Bot,
  Megaphone,
  Workflow,
  Users,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const modules = [
  {
    icon: Megaphone,
    name: "ad_management",
    detail: "Campaigns, budgets, channel sync status",
  },
  {
    icon: Bot,
    name: "content_studio",
    detail: "AI drafts, variants, human approval",
  },
  {
    icon: Workflow,
    name: "automation",
    detail: "Rules, schedules, budget shifts",
  },
  {
    icon: Users,
    name: "crm",
    detail: "Accounts, contacts, activity timeline",
  },
];

const bootLines = [
  { time: "00:00.12", text: "design.tokens .......... loaded", ok: true },
  { time: "00:00.48", text: "type.scale ............. loaded", ok: true },
  { time: "00:00.73", text: "component.library ...... 60+ parts", ok: true },
  { time: "00:01.05", text: "motion.system .......... calibrated", ok: true },
  { time: "00:01.31", text: "a11y.contrast .......... wcag 2.2 AA", ok: true },
  { time: "00:01.62", text: "phase.1 ................ ready", ok: true },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-mono text-small font-semibold">
            <span className="grid size-6 place-items-center rounded-sm bg-primary text-primary-foreground text-caption">
              T
            </span>
            terminal<span className="text-terminal-green">/</span>1
          </a>
          <span className="hidden font-mono text-caption text-muted-foreground md:block">
            design system for an ad-management platform
          </span>
          <Button asChild size="sm" className="ml-auto">
            <a href="/system">open design system</a>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b bg-grid">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
          <p className="font-mono text-caption text-terminal-green">
            ▸ system.boot(design-language="terminal") — ok
          </p>
          <h1 className="mt-5 max-w-3xl font-mono text-display">
            Sophisticated underneath.
            <br />
            Simple on the surface
            <span className="animate-caret text-terminal-green">▌</span>
          </h1>
          <p className="mt-4 max-w-2xl font-mono text-body text-muted-foreground">
            Phase 1 of an ad-management platform: a complete visual language —
            tokens, typography, motion, accessibility — shipped as a live,
            browsable component library. Not screens. Not workflows. The
            building blocks the product will be made of.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <a href="/system">
                Explore the library
                <ArrowRight className="size-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#modules">See what it will power</a>
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-2 font-mono text-caption text-muted-foreground">
            <Kbd>tokens</Kbd>
            <Kbd>states</Kbd>
            <Kbd>motion</Kbd>
            <Kbd>a11y</Kbd>
            <span>— every section documented live</span>
          </div>
        </div>
      </section>

      {/* Boot sequence */}
      <section className="border-b bg-dots">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="overflow-hidden rounded-md border bg-card shadow-card">
            <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-1.5">
              <span className="size-2 rounded-full bg-terminal-green" />
              <span className="font-mono text-caption text-muted-foreground">
                boot.log — phase 1
              </span>
            </div>
            <div className="p-4 font-mono text-small">
              {bootLines.map((l) => (
                <div key={l.time} className="flex items-baseline gap-3 py-0.5">
                  <span className="shrink-0 text-muted-foreground">{l.time}</span>
                  <span className="min-w-0 truncate">{l.text}</span>
                  <span className="ml-auto shrink-0 text-terminal-green">[ok]</span>
                  <span className="w-6 shrink-0" />
                </div>
              ))}
              <div className="flex items-baseline gap-3 pt-1 text-terminal-green">
                <span>▸</span>
                <span className="animate-caret">▌</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="border-b">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <p className="font-mono text-caption text-terminal-green">▸ what it will power</p>
          <h2 className="mt-2 font-mono text-h1">Four future modules, one language</h2>
          <p className="mt-2 max-w-2xl font-mono text-small text-muted-foreground">
            The system is built to compose into these surfaces in phase 2 —
            without redesign. None of these screens exist yet; they are the
            reason the tokens look the way they do.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((m) => (
              <div
                key={m.name}
                className="group rounded-md border bg-card p-4 shadow-card transition-all ease-terminal hover:-translate-y-0.5 hover:border-terminal-green/50 hover:shadow-pop"
              >
                <m.icon className="size-5 text-terminal-green" />
                <p className="mt-3 font-mono text-small font-medium">{m.name}</p>
                <p className="mt-1 font-mono text-caption text-muted-foreground">
                  {m.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-scanlines">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
          <h2 className="font-mono text-h1">The components are live</h2>
          <p className="mx-auto mt-2 max-w-xl font-mono text-small text-muted-foreground">
            Every token, state and motion curve — running in the browser. Phase
            2 composes these parts into real product screens.
          </p>
          <Button asChild size="lg" className="mt-6">
            <a href="/system">
              Open the component library
              <ArrowRight className="size-4" />
            </a>
          </Button>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 font-mono text-caption text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span>terminal/1 — phase 1 · design system</span>
          <span className="sm:ml-auto">tokens · states · motion · a11y — all contract</span>
        </div>
      </footer>
    </div>
  );
}
