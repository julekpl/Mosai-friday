import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Blocks,
  Check,
  FileCheck2,
  Megaphone,
  PenTool,
  Route,
  Search,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  MosaicMark,
  moduleTileBg,
  moduleTileChip,
} from "@/components/mosaic";
import {
  LazyMosaicField,
  PageTransition,
  ScrollReveal,
} from "@/components/fx";
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
  { label: "Business" },
  { label: "Audience" },
  { label: "Draft it" },
  { label: "Review" },
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
                "flex h-full w-full flex-col items-start justify-center gap-1.5 px-2 py-2.5 text-left transition-colors duration-150 ease-terminal sm:px-3",
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
      <div className="min-h-[10rem] px-4 py-6 sm:px-5 sm:py-8">
        <PageTransition transitionKey={step} preset="rise" animateOnMount={false}>
          <DemoPanel step={step} />
        </PageTransition>
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

/** Every component the shared project context feeds (hero overview card). */
const contextModules = [
  { id: "understand", name: "Understand", icon: Search },
  { id: "journeys", name: "Journeys", icon: Route },
  { id: "create", name: "Create", icon: PenTool },
  { id: "build", name: "Build", icon: Blocks },
  { id: "customers", name: "Customers", icon: Users },
  { id: "promote", name: "Promote", icon: Megaphone },
  { id: "sell", name: "Sell", icon: ShoppingBag },
  { id: "grow", name: "Grow", icon: TrendingUp },
] as const;

/** Facts restated from the product copy — no counts, no testimonials. */
const heroFacts = [
  "Sign in with an email code",
  "Free plan: Understand, Journeys and Create",
  "Nothing is shared until you say so",
] as const;

function SectionHeader({
  eyebrow,
  title,
  lede,
  id,
}: {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  id: string;
}) {
  return (
    <ScrollReveal>
      <p className="font-mono text-caption text-terminal-green">▸ {eyebrow}</p>
      <h2 id={id} className="mt-2 max-w-3xl font-mono text-h1">
        {title}
      </h2>
      {lede && (
        <p className="mt-3 max-w-2xl font-mono text-small text-muted-foreground">
          {lede}
        </p>
      )}
    </ScrollReveal>
  );
}

const ctaMotion =
  "transition-transform duration-300 ease-mosaic hover:-translate-y-0.5 active:translate-y-0 active:scale-95";

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
            <Button asChild size="sm" className="hidden sm:inline-flex">
              <a href="/auth">Create your workspace</a>
            </Button>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {/* Hero — the product, plainly explained, over a living mosaic */}
        <section
          aria-labelledby="hero-title"
          className="relative isolate overflow-hidden border-b"
        >
          <LazyMosaicField variant="hero" className="-z-20" />
          {/* Readability scrim: solid paper behind the copy (WCAG 2.2 AA),
              thinning out towards the field on wide screens. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-background/95 via-background/85 to-background/50 lg:bg-gradient-to-r lg:from-background lg:via-background/80 lg:to-background/0"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 bg-gradient-to-t from-background to-transparent"
          />

          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:px-6 md:pb-28 md:pt-24 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <p className="animate-mosaic-in inline-flex items-center gap-2 rounded-full border bg-card/90 px-3 py-1 font-mono text-caption text-muted-foreground shadow-hairline backdrop-blur">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-terminal-green"
                />
                mosai — one marketing workspace for a small business
              </p>
              <h1
                id="hero-title"
                className="animate-mosaic-in mt-6 font-mono text-h1 sm:text-display"
                style={{ animationDelay: "80ms" }}
              >
                Your marketing,
                <br />
                coming together.
              </h1>
              <p
                className="animate-mosaic-in mt-5 max-w-xl font-mono text-body text-muted-foreground"
                style={{ animationDelay: "160ms" }}
              >
                Understand your audience, make the content, and organize your
                next move — with what you know about your business close at
                hand. AI does the first pass; you review, edit and save the
                work.
              </p>
              <div
                className="animate-mosaic-in mt-8 flex flex-wrap items-center gap-3"
                style={{ animationDelay: "240ms" }}
              >
                <Button
                  asChild
                  size="lg"
                  className={cn("shadow-pop hover:scale-[1.02]", ctaMotion)}
                >
                  <a href="/auth">
                    Create your workspace
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </a>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className={cn(
                    "bg-card/80 backdrop-blur hover:border-terminal-green/50",
                    ctaMotion,
                  )}
                >
                  <a href="#demo">See how it works</a>
                </Button>
              </div>
              <ul
                className="animate-mosaic-in mt-8 flex flex-col gap-2 font-mono text-caption text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-5"
                style={{ animationDelay: "320ms" }}
                aria-label="Before you start"
              >
                {heroFacts.map((fact) => (
                  <li key={fact} className="flex items-center gap-1.5">
                    <Check
                      aria-hidden="true"
                      className="size-3.5 shrink-0 text-terminal-green"
                    />
                    {fact}
                  </li>
                ))}
              </ul>
            </div>

            {/* One context, every component — what the mosaic stands for */}
            <div
              className="animate-mosaic-in lg:col-span-5"
              style={{ animationDelay: "360ms" }}
            >
              <div className="mx-auto max-w-md rounded-xl border bg-card/90 p-5 shadow-float backdrop-blur-md">
                <p className="font-mono text-caption text-muted-foreground">
                  one project context
                </p>
                <p className="mt-1 font-mono text-small font-medium">
                  business · audience · journey · content
                </p>
                <div aria-hidden="true" className="my-4 h-px bg-border" />
                <p className="font-mono text-caption text-muted-foreground">
                  read by every component
                </p>
                <ul className="mt-3 grid grid-cols-2 gap-2">
                  {contextModules.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-2 rounded-md border bg-background/60 px-2 py-1.5"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded",
                          moduleTileChip(m.id),
                        )}
                      >
                        <m.icon className="size-3.5" />
                      </span>
                      <span className="font-mono text-caption font-medium">
                        {m.name}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 font-mono text-caption text-muted-foreground">
                  Each is useful on its own and better when the others are
                  there.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Demonstration */}
        <section
          id="demo"
          aria-labelledby="demo-title"
          className="border-b bg-dots"
        >
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <SectionHeader
              id="demo-title"
              eyebrow="one task, start to finish"
              title="Something useful happens quickly"
              lede="A bakery owner tells MOSAI what the business is, picks who they're writing for, asks for an announcement, and reviews the draft. Click through the steps — this is example content, not a real account."
            />
            <ScrollReveal preset="scale" delay={0.08} className="mt-8">
              <Demo />
            </ScrollReveal>
          </div>
        </section>

        {/* How it works */}
        <section id="how" aria-labelledby="how-title" className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <SectionHeader
              id="how-title"
              eyebrow="how it works"
              title="Context first, then work you can review"
            />
            <ol className="relative mt-10 grid gap-3 md:grid-cols-3">
              {/* Decorative connector between the three steps */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-8 top-9 hidden h-px bg-gradient-to-r from-tile-teal via-tile-violet to-tile-coral opacity-50 md:block"
              />
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
                // <ol> — the reveal wrapper renders a div, so it belongs
                // *inside* the li (BP-01: this markup bug failed the a11y gate).
                <li
                  key={s.n}
                  className="relative h-full rounded-md border bg-card p-5 shadow-card"
                >
                  <ScrollReveal preset="mosaic" delay={i * 0.08}>
                    <span className="grid size-8 place-items-center rounded-[3px] bg-terminal-green font-mono text-caption font-semibold text-background">
                      {s.n}
                    </span>
                    <p className="mt-4 font-mono text-small font-medium">
                      {s.title}
                    </p>
                    <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                      {s.body}
                    </p>
                  </ScrollReveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The seven components */}
        <section
          id="components"
          aria-labelledby="components-title"
          className="border-b bg-dots"
        >
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <SectionHeader
              id="components-title"
              eyebrow="what you can do"
              title="Seven components"
              lede="Each one is useful on its own and better when the others are there. Your plan decides which are active — the sidebar always tells you."
            />
            <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {components.map((m, i) => (
                <ScrollReveal
                  key={m.name}
                  preset="mosaic"
                  delay={(i % 3) * 0.06}
                  className="h-full"
                >
                  <article className="group relative h-full overflow-hidden rounded-md border bg-card p-5 shadow-card transition-all duration-300 ease-mosaic hover:-translate-y-1 hover:border-terminal-green/40 hover:shadow-pop">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 transition-transform duration-500 ease-terminal group-hover:scale-x-100",
                        moduleTileBg(m.id),
                      )}
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "grid size-9 place-items-center rounded-md transition-transform duration-300 ease-mosaic",
                        "group-hover:scale-110 group-hover:-rotate-6",
                        moduleTileChip(m.id),
                      )}
                    >
                      <m.icon className="size-5" />
                    </span>
                    <h3 className="mt-4 font-mono text-small font-semibold">
                      {m.name}{" "}
                      <span className="text-muted-foreground">— </span>
                      {m.task}
                    </h3>
                    <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                      {m.detail}
                    </p>
                  </article>
                </ScrollReveal>
              ))}
            </div>
            <ScrollReveal delay={0.12}>
              <p className="mt-5 font-mono text-caption text-muted-foreground">
                Journeys — the steps your customers actually take — sits next to
                Understand in every workspace, and feeds Create and Build.
              </p>
            </ScrollReveal>
          </div>
        </section>

        {/* Control and trust */}
        <section
          id="control"
          aria-labelledby="control-title"
          className="border-b"
        >
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <SectionHeader
              id="control-title"
              eyebrow="your control"
              title="Nothing is live unless you made it live"
            />
            <div className="mt-10 grid gap-3 md:grid-cols-3">
              {[
                {
                  icon: FileCheck2,
                  title: "Drafts stay drafts",
                  body: "Saving is saving. Publishing is a separate, reviewed step — and a page only shows as published when the system actually published it.",
                },
                {
                  icon: PenTool,
                  title: "You hold the pen",
                  body: "AI writes the first version; you edit every word. Tone, audience and length are visible settings, not hidden magic.",
                },
                {
                  icon: ShieldCheck,
                  title: "Connect only what you choose",
                  body: "Sharing to social accounts requires connecting them first, with your own login. Marketing consent is stored per contact and checked before any send.",
                },
              ].map((c, i) => (
                <ScrollReveal
                  key={c.title}
                  preset="rise"
                  delay={i * 0.07}
                  className="h-full"
                >
                  <div className="h-full rounded-md border bg-card p-5 shadow-card">
                    <c.icon
                      aria-hidden="true"
                      className="size-5 text-terminal-green"
                    />
                    <h3 className="mt-3 font-mono text-small font-medium">
                      {c.title}
                    </h3>
                    <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                      {c.body}
                    </p>
                  </div>
                </ScrollReveal>
              ))}
            </div>
            <ScrollReveal delay={0.14}>
              <p className="mt-5 font-mono text-caption text-muted-foreground">
                Your project is exportable as a readable pack at any time —
                context, personas and content in one file.
              </p>
            </ScrollReveal>
          </div>
        </section>

        {/* Final action */}
        <section
          id="start"
          aria-labelledby="start-title"
          className="relative isolate overflow-hidden"
        >
          <LazyMosaicField variant="ambient" className="-z-20" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-background/30"
          />
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
            <ScrollReveal
              preset="scale"
              className="mx-auto max-w-2xl rounded-xl border bg-card/95 p-8 text-center shadow-float backdrop-blur-md sm:p-12"
            >
              <div
                aria-hidden="true"
                className="mx-auto mb-5 flex justify-center gap-1"
              >
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
                    <span
                      className={cn("block size-full rounded-[3px]", tile)}
                    />
                  </span>
                ))}
              </div>
              <h2 id="start-title" className="font-mono text-h1">
                Start with a workspace
              </h2>
              <p className="mx-auto mt-3 max-w-xl font-mono text-small text-muted-foreground">
                Sign in with an email code, name your project, and add what your
                business does. Your first draft is a few clicks after that.
              </p>
              <Button
                asChild
                size="lg"
                className={cn("mt-7 shadow-pop hover:scale-[1.03]", ctaMotion)}
              >
                <a href="/auth">
                  Create your workspace
                  <ArrowRight aria-hidden="true" className="size-4" />
                </a>
              </Button>
              <p className="mt-4 font-mono text-caption text-muted-foreground">
                Free plan includes Understand, Journeys and Create — add
                modules as you grow.
              </p>
            </ScrollReveal>
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
