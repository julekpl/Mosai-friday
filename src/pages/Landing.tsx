import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Blocks,
  Megaphone,
  PenTool,
  Search,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  FloatingTiles,
  MosaicMark,
  Reveal,
  moduleTileText,
} from "@/components/mosaic";
import { SkipLink } from "@/components/SkipLink";
import { StatusBadge } from "@/components/app/module-kit";
import { cn } from "@/lib/utils";

/* ── The seven components, described as customer tasks ────────────────── */

const components = [
  {
    icon: Search,
    id: "understand",
    name: "Understand",
    task: "Know who you're selling to.",
    detail:
      "Write down your audiences — their goals, their frustrations, the evidence — so every later decision has somewhere to start.",
  },
  {
    icon: PenTool,
    id: "create",
    name: "Create",
    task: "Make something worth reading.",
    detail:
      "Draft posts, pages and emails grounded in what you know about your audience — then edit every word before you save it.",
  },
  {
    icon: Blocks,
    id: "build",
    name: "Build",
    task: "Make a place for your business.",
    detail:
      "Plan and build a website page by page, with your positioning and your audience in view the whole way.",
  },
  {
    icon: Users,
    id: "customers",
    name: "Customers",
    task: "Keep your people close.",
    detail:
      "Contacts, company details and marketing consent in one list you own — consent is checked before anything sends.",
  },
  {
    icon: Megaphone,
    id: "promote",
    name: "Promote",
    task: "Get your next message ready.",
    detail:
      "Prepare posts and campaigns, review them, and connect your own accounts when you're ready to share.",
  },
  {
    icon: ShoppingBag,
    id: "sell",
    name: "Sell",
    task: "Bring your products together.",
    detail:
      "Names, prices and availability in one catalog, checked for readiness before anything goes live.",
  },
  {
    icon: TrendingUp,
    id: "grow",
    name: "Grow",
    task: "See what's working.",
    detail:
      "Insights that keep their source and their date — no blended scores, no charts drawn from nothing.",
  },
] as const;

/* ── Small demonstration: one believable task, labelled as an example ─── */

const demoSteps = [
  { label: "Your business" },
  { label: "Your audience" },
  { label: "Draft it" },
  { label: "Review & save" },
  { label: "Social media" },
  { label: "Ads" },
  { label: "Email" },
  { label: "App" },
  { label: "Ecom" },
] as const;

function DemoPanel({ step }: { step: number }) {
  if (step === 0) {
    return (
      <div className="grid gap-3">
        <p className="font-mono text-caption text-muted-foreground">
          business details
        </p>
        <p className="font-mono text-small font-medium">
          Hearth — a neighbourhood bakery
        </p>
        <p className="font-mono text-caption text-muted-foreground">
          sourdough, pastries and weekend classes · Berlin · sells in-store and
          through a small web shop
        </p>
        <div className="flex flex-wrap gap-1.5">
          {["weekend classes", "sourdough", "in-store + web"].map((t) => (
            <span
              key={t}
              className="rounded-full border border-terminal-green/40 bg-terminal-green-soft px-2.5 py-0.5 font-mono text-caption text-terminal-green"
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="grid gap-3">
        <p className="font-mono text-caption text-muted-foreground">
          audience
        </p>
        <p className="font-mono text-small font-medium">
          Weekend regulars — families &amp; freelancers
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="font-mono text-caption text-terminal-green">goals</p>
            <p className="mt-1 font-mono text-caption">
              a reliable Saturday treat · learning to bake at home
            </p>
          </div>
          <div className="rounded-md border bg-muted/40 p-3">
            <p className="font-mono text-caption text-terminal-amber">
              frustrations
            </p>
            <p className="mt-1 font-mono text-caption">
              classes sell out · unclear opening hours
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (step === 2) {
    return (
      <div className="grid gap-3">
        <p className="font-mono text-caption text-muted-foreground">
          draft · not yet saved
        </p>
        <div className="rounded-md border bg-card p-4 shadow-card">
          <p className="font-mono text-small font-medium">
            New: Saturday sourdough class
          </p>
          <p className="mt-1.5 font-mono text-caption text-muted-foreground">
            Ever wanted to shape a loaf of your own? Join us Saturdays from 9 —
            a small group, one batch of dough, and a loaf to take home. Spaces
            are limited to eight bakers per class.
          </p>
        </div>
        <p className="font-mono text-caption text-muted-foreground">
          Written from your business details and the audience you picked — the
          tone and length are settings you can change.
        </p>
      </div>
    );
  }
  if (step >= 5) {
    const extra = demoExtras[step - 5];
    return (
      <div className="grid gap-3">
        <p className="font-mono text-caption text-muted-foreground">
          {extra.slug}
        </p>
        <div className="rounded-md border bg-card p-4 shadow-card">
          <p className="font-mono text-small font-medium">{extra.title}</p>
          <p className="mt-1.5 font-mono text-caption text-muted-foreground">
            {extra.body}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <p className="font-mono text-caption text-muted-foreground">
        after review
      </p>
      <div className="rounded-md border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-small font-medium">
            New: Saturday sourdough class
          </p>
          <StatusBadge status="draft" />
        </div>
        <p className="mt-1.5 font-mono text-caption text-muted-foreground">
          You trimmed one sentence, liked the rest, and saved it. It sits in
          your drafts until you decide to use it.
        </p>
      </div>
      <p className="font-mono text-caption text-muted-foreground">
        Saving is not publishing. Sharing happens only when you connect an
        account and press the button yourself.
      </p>
    </div>
  );
}

/* Extra modules shown alongside the demo workflow */

const demoExtras = [
  {
    slug: "social · not connected",
    title: "Share the news, when you're ready",
    body: "Connect your own account, review the post, and press publish yourself.",
  },
  {
    slug: "ads · budget set by you",
    title: "Reach more weekend visitors",
    body: "Draft a small local campaign from the announcement — you set the budget.",
  },
  {
    slug: "email · consent checked",
    title: "Tell your regulars",
    body: "A newsletter for subscribers who asked to hear about classes.",
  },
  {
    slug: "app · in progress",
    title: "A small hub for your customers",
    body: "Hours, menus and bookings in one place, built from the same context.",
  },
  {
    slug: "ecom · web shop",
    title: "Sell the bread, book the class",
    body: "Products and prices in one catalog, checked before anything goes live.",
  },
] as const;

function Demo() {
  const [step, setStep] = useState(0);
  return (
    <div className="overflow-hidden rounded-md border bg-card shadow-card">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/60 px-3 py-1.5">
        <span className="size-2 rounded-full bg-terminal-green" />
        <span className="font-mono text-caption text-muted-foreground">
          example workspace — a fictional bakery, shown for illustration
        </span>
      </div>
      {/* Horizontal step selector */}
      <ol className="grid grid-cols-3 divide-x divide-border border-b md:grid-cols-9">
        {demoSteps.map((s, i) => (
          <li key={s.label}>
            <button
              type="button"
              aria-current={step === i ? "step" : undefined}
              onClick={() => setStep(i)}
              className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-1.5 px-2 py-2.5 text-center transition-colors duration-150 ease-terminal sm:px-3",
                step === i
                  ? "bg-terminal-green-soft"
                  : "hover:bg-accent focus-visible:bg-accent",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-[3px] font-mono text-caption transition-colors duration-150",
                  step === i
                    ? "bg-terminal-green text-background"
                    : "border text-muted-foreground",
                )}
                aria-hidden
              >
                {i + 1}
              </span>
              <span className="block font-mono text-caption font-medium sm:text-small">
                {s.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="min-h-[10rem] p-4 sm:p-5">
        <DemoPanel step={step} />
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */

const navLinks = [
  { href: "#demo", label: "See it work" },
  { href: "#how", label: "How it works" },
  { href: "#components", label: "What you can do" },
  { href: "#control", label: "Your control" },
] as const;

export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <SkipLink />
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <a
            href="/"
            className="group flex items-center gap-2 font-mono text-small font-semibold"
          >
            <MosaicMark size={22} interactive />
            <span className="transition-colors group-hover:text-terminal-green">
              mosai
            </span>
          </a>
          <nav aria-label="Page sections" className="hidden md:block">
            <ul className="ml-4 flex items-center gap-5">
              {navLinks.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="font-mono text-caption text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <a href="/auth">Sign in</a>
            </Button>
            <Button asChild size="sm">
              <a href="/auth">Create your workspace</a>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {/* Hero — direction B: the product, plainly explained */}
        <section className="relative overflow-hidden border-b bg-grid">
          <FloatingTiles />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
            <p className="animate-mosaic-in font-mono text-caption text-terminal-green">
              ▸ mosai — one marketing workspace for a small business
            </p>
            <h1
              className="animate-mosaic-in mt-5 max-w-3xl font-mono text-display"
              style={{ animationDelay: "80ms" }}
            >
              Your marketing,
              <br />
              coming together.
            </h1>
            <p
              className="animate-mosaic-in mt-5 max-w-2xl font-mono text-body text-muted-foreground"
              style={{ animationDelay: "160ms" }}
            >
              Understand your audience, make the content, and organize your next
              move — with what you know about your business close at hand. AI
              does the first pass; you review, edit and save the work.
            </p>
            <div
              className="animate-mosaic-in mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "240ms" }}
            >
              <Button
                asChild
                size="lg"
                className="shadow-pop transition-transform duration-300 ease-mosaic hover:-translate-y-0.5 hover:scale-[1.02] active:translate-y-0 active:scale-95"
              >
                <a href="/auth">
                  Create your workspace
                  <ArrowRight className="size-4" />
                </a>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="transition-transform duration-300 ease-mosaic hover:-translate-y-0.5 hover:border-terminal-green/50 active:translate-y-0 active:scale-95"
              >
                <a href="#demo">See how it works</a>
              </Button>
            </div>
            <p
              className="animate-mosaic-in mt-5 max-w-2xl font-mono text-caption text-muted-foreground"
              style={{ animationDelay: "320ms" }}
            >
              Sign in with an email code to begin. New workspaces start on the
              free plan — Understand, Journeys and Create — and you can add the
              rest as you grow.
            </p>
          </div>
        </section>

        {/* Demonstration */}
        <section id="demo" className="border-b bg-dots">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
            <Reveal>
              <p className="font-mono text-caption text-terminal-green">
                ▸ one task, start to finish
              </p>
              <h2 className="mt-2 font-mono text-h1">
                Something useful happens quickly
              </h2>
              <p className="mt-2 max-w-2xl font-mono text-small text-muted-foreground">
                A bakery owner tells MOSAI what the business is, picks who
                they're writing for, asks for an announcement, and reviews the
                draft. Click through the steps — this is example content, not a
                real account.
              </p>
            </Reveal>
            <Reveal delay={80}>
              <div className="mt-6">
                <Demo />
              </div>
            </Reveal>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <Reveal>
              <p className="font-mono text-caption text-terminal-green">
                ▸ how it works
              </p>
              <h2 className="mt-2 font-mono text-h1">
                Context first, then work you can review
              </h2>
            </Reveal>
            <ol className="mt-8 grid gap-3 md:grid-cols-3">
              {[
                {
                  n: "1",
                  title: "Add your business context",
                  body: "What you sell, who buys it, where you sell it. One project holds it, and every component reads from it.",
                },
                {
                  n: "2",
                  title: "Ask for the work",
                  body: "A post, a page, a plan, a product listing. AI drafts it from that context instead of from nothing.",
                },
                {
                  n: "3",
                  title: "Review, edit and save",
                  body: "Every AI result arrives as an editable draft. You decide what's good — and nothing is shared until you say so.",
                },
              ].map((s, i) => (
                // axe rule `list`/`listitem`: <li> must be a direct child of
                // <ol> — Reveal renders a div, so it belongs *inside* the li
                // (BP-01: this markup bug failed the a11y gate).
                <li
                  key={s.n}
                  className="h-full rounded-md border bg-card p-5 shadow-card"
                >
                  <Reveal delay={i * 70}>
                    <span className="grid size-7 place-items-center rounded-[3px] bg-terminal-green font-mono text-caption text-background">
                      {s.n}
                    </span>
                    <p className="mt-3 font-mono text-small font-medium">
                      {s.title}
                    </p>
                    <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                      {s.body}
                    </p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The seven components */}
        <section id="components" className="border-b bg-dots">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <Reveal>
              <p className="font-mono text-caption text-terminal-green">
                ▸ what you can do
              </p>
              <h2 className="mt-2 font-mono text-h1">Seven components</h2>
              <p className="mt-2 max-w-2xl font-mono text-small text-muted-foreground">
                Each one is useful on its own and better when the others are
                there. Your plan decides which are active — the sidebar always
                tells you.
              </p>
            </Reveal>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {components.map((m, i) => (
                <Reveal key={m.name} delay={i * 60}>
                  <article className="group h-full rounded-md border bg-card p-4 shadow-card transition-all duration-300 ease-mosaic hover:-translate-y-1 hover:rotate-[-0.4deg] hover:scale-[1.02] hover:border-terminal-green/40 hover:shadow-pop">
                    <span
                      className={cn(
                        "grid size-9 place-items-center rounded-md transition-transform duration-300 ease-mosaic",
                        "group-hover:scale-110 group-hover:-rotate-6",
                      )}
                    >
                      <m.icon className={cn("size-5", moduleTileText(m.id))} />
                    </span>
                    <p className="mt-3 font-mono text-small font-semibold">
                      {m.name} <span className="text-muted-foreground">— </span>
                      {m.task}
                    </p>
                    <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                      {m.detail}
                    </p>
                  </article>
                </Reveal>
              ))}
            </div>
            <Reveal delay={120}>
              <p className="mt-4 font-mono text-caption text-muted-foreground">
                Journeys — the steps your customers actually take — sits next to
                Understand in every workspace, and feeds Create and Build.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Control and trust */}
        <section id="control" className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <Reveal>
              <p className="font-mono text-caption text-terminal-green">
                ▸ your control
              </p>
              <h2 className="mt-2 font-mono text-h1">
                Nothing is live unless you made it live
              </h2>
            </Reveal>
            <div className="mt-8 grid gap-3 md:grid-cols-3">
              {[
                {
                  title: "Drafts stay drafts",
                  body: "Saving is saving. Publishing is a separate, reviewed step — and a page only shows as published when the system actually published it.",
                },
                {
                  title: "You hold the pen",
                  body: "AI writes the first version; you edit every word. Tone, audience and length are visible settings, not hidden magic.",
                },
                {
                  title: "Connect only what you choose",
                  body: "Sharing to social accounts requires connecting them first, with your own login. Marketing consent is stored per contact and checked before any send.",
                },
              ].map((c, i) => (
                <Reveal key={c.title} delay={i * 70}>
                  <div className="h-full rounded-md border bg-card p-5 shadow-card">
                    <p className="font-mono text-small font-medium">
                      {c.title}
                    </p>
                    <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                      {c.body}
                    </p>
                  </div>
                </Reveal>
              ))}
            </div>
            <Reveal delay={140}>
              <p className="mt-4 font-mono text-caption text-muted-foreground">
                Your project is exportable as a readable pack at any time —
                context, personas and content in one file.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Final action */}
        <section id="start" className="relative overflow-hidden bg-scanlines">
          <FloatingTiles className="opacity-70" />
          <div className="relative mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
            <Reveal>
              <div className="mx-auto mb-4 flex justify-center gap-1">
                {(
                  [
                    "bg-tile-teal",
                    "bg-tile-coral",
                    "bg-tile-violet",
                    "bg-tile-lime",
                  ] as const
                ).map((tile, i) => (
                  <span
                    key={tile}
                    className="animate-mosaic-pop size-4 rounded-[3px] shadow-hairline"
                    style={{ animationDelay: `${i * 110}ms` }}
                  >
                    <span className={cn("block size-full rounded-[3px]", tile)} />
                  </span>
                ))}
              </div>
              <h2 className="font-mono text-h1">Start with a workspace</h2>
              <p className="mx-auto mt-3 max-w-xl font-mono text-small text-muted-foreground">
                Sign in with an email code, name your project, and add what your
                business does. Your first draft is a few clicks after that.
              </p>
              <Button
                asChild
                size="lg"
                className="mt-6 shadow-pop transition-transform duration-300 ease-mosaic hover:-translate-y-0.5 hover:scale-[1.03] active:translate-y-0 active:scale-95"
              >
                <a href="/auth">
                  Create your workspace
                  <ArrowRight className="size-4" />
                </a>
              </Button>
              <p className="mt-4 font-mono text-caption text-muted-foreground">
                Free plan includes Understand, Journeys and Create — add
                modules as you grow.
              </p>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 font-mono text-caption text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span className="flex items-center gap-2">
            <MosaicMark size={16} />
            mosai — understand · create · build · customers · promote · sell ·
            grow
          </span>
          <span className="sm:ml-auto">
            drafts first, publishing only when you confirm it
          </span>
        </div>
      </footer>
    </div>
  );
}
