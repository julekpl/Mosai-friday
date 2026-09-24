import { useEffect, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, ArrowRight, Check, Info, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MosaicMark, moduleTileBg, moduleTileChip } from "@/components/mosaic";
import { ScrollReveal } from "@/components/fx";
import { SkipLink } from "@/components/SkipLink";
import { cn } from "@/lib/utils";
import NotFound from "@/pages/NotFound";
import {
  MODULE_LANDING_LIST,
  MODULE_LANDINGS,
  moduleAvailability,
  moduleLanding,
  type ModuleLandingContent,
} from "./module-landing-content";

/**
 * Public landing page for one content (`/modules/:moduleId`): what it does, why
 * it helps, how it fits with the rest, and where it is available. All copy
 * comes from `module-landing-content.ts`; this file is layout only.
 */

const ctaMotion =
  "transition-transform duration-300 ease-mosaic hover:-translate-y-0.5 active:translate-y-0 active:scale-95";

function Section({
  id,
  eyebrow,
  title,
  lede,
  tinted,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
  tinted?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn("border-b", tinted && "bg-dots")}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
        <ScrollReveal>
          <p className="font-mono text-caption text-terminal-green">
            ▸ {eyebrow}
          </p>
          <h2 id={`${id}-title`} className="mt-2 max-w-3xl font-mono text-h1">
            {title}
          </h2>
          {lede && (
            <p className="mt-3 max-w-2xl font-mono text-small text-muted-foreground">
              {lede}
            </p>
          )}
        </ScrollReveal>
        {children}
      </div>
    </section>
  );
}

function ModuleChip({ id, className }: { id: string; className?: string }) {
  const Icon = MODULE_LANDINGS[id as keyof typeof MODULE_LANDINGS].icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-md",
        moduleTileChip(id),
        className,
      )}
    >
      <Icon className="size-1/2" />
    </span>
  );
}

export function ModuleLandingView({ content }: { content: ModuleLandingContent }) {
  const availability = moduleAvailability(content.id);
  const others = MODULE_LANDING_LIST.filter((m) => m.id !== content.id);

  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <SkipLink />
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link
            to="/"
            className="group flex items-center gap-2 font-mono text-small font-semibold"
          >
            <MosaicMark size={22} interactive />
            <span className="transition-colors group-hover:text-terminal-green">
              mosai
            </span>
          </Link>
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="font-mono text-caption text-muted-foreground">
            {content.name.toLowerCase()}
          </span>
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
        {/* Hero */}
        <section
          aria-labelledby="module-hero-title"
          className="relative isolate overflow-hidden border-b"
        >
          <span
            aria-hidden="true"
            className={cn("absolute inset-x-0 top-0 h-1", moduleTileBg(content.id))}
          />
          <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 pb-16 pt-12 sm:px-6 md:pb-24 md:pt-16 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <Link
                to="/#components"
                className="inline-flex items-center gap-1.5 font-mono text-caption text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft aria-hidden="true" className="size-3.5" />
                All modules
              </Link>
              <p className="animate-mosaic-in mt-6 flex items-center gap-2 font-mono text-caption text-muted-foreground">
                <ModuleChip id={content.id} className="size-7" />
                <span>
                  <span className="font-semibold text-foreground">
                    {content.name}
                  </span>{" "}
                  · {content.task}
                </span>
              </p>
              <h1
                id="module-hero-title"
                className="animate-mosaic-in mt-5 font-mono text-h1 sm:text-display"
                style={{ animationDelay: "80ms" }}
              >
                {content.headline}
              </h1>
              <p
                className="animate-mosaic-in mt-5 max-w-xl font-mono text-body text-muted-foreground"
                style={{ animationDelay: "160ms" }}
              >
                {content.lede}
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
                    Try {content.name}
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline" className={ctaMotion}>
                  <a href="#features">What it does</a>
                </Button>
              </div>
              <p
                className="animate-mosaic-in mt-6 flex items-center gap-1.5 font-mono text-caption text-muted-foreground"
                style={{ animationDelay: "320ms" }}
              >
                <Check
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-terminal-green"
                />
                {availability.label}
              </p>
            </div>

            {/* Sound familiar? The problem, in the customer's words */}
            <div
              className="animate-mosaic-in lg:col-span-5"
              style={{ animationDelay: "360ms" }}
            >
              <div className="rounded-xl border bg-card p-5 shadow-float">
                <h2 className="font-mono text-caption text-muted-foreground">
                  sound familiar?
                </h2>
                <ul className="mt-3 grid gap-2.5">
                  {content.problems.map((problem) => (
                    <li
                      key={problem}
                      className="rounded-md border bg-background/60 px-3 py-2.5 font-mono text-caption"
                    >
                      {problem}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 font-mono text-caption text-muted-foreground">
                  {content.name} is built for exactly this.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <Section
            id="features"
            eyebrow="what you get"
            title={`What ${content.name} does for you`}
            tinted
          >
            <ul className="mt-10 grid gap-3 sm:grid-cols-2">
              {content.features.map((feature, i) => (
                <li key={feature.title} className="h-full">
                  <ScrollReveal
                    preset="mosaic"
                    delay={(i % 2) * 0.06}
                    className="h-full"
                  >
                    <article className="group relative h-full overflow-hidden rounded-md border bg-card p-5 shadow-card transition-all duration-300 ease-mosaic hover:-translate-y-1 hover:shadow-pop">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute inset-y-0 left-0 w-0.5",
                          moduleTileBg(content.id),
                        )}
                      />
                      <h3 className="font-mono text-small font-semibold">
                        {feature.title}
                      </h3>
                      <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                        {feature.body}
                      </p>
                    </article>
                  </ScrollReveal>
                </li>
              ))}
            </ul>
        </Section>

        {/* How it works */}
        <Section id="how" eyebrow="how it works" title="Three steps to useful">
          <ol className="mt-10 grid gap-3 md:grid-cols-3">
            {content.steps.map((step, i) => (
              <li
                key={step.title}
                className="h-full rounded-md border bg-card p-5 shadow-card"
              >
                <ScrollReveal preset="mosaic" delay={i * 0.08}>
                  <span className="grid size-8 place-items-center rounded-[3px] bg-terminal-green font-mono text-caption font-semibold text-background">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-mono text-small font-medium">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                    {step.body}
                  </p>
                </ScrollReveal>
              </li>
            ))}
          </ol>
        </Section>

        {/* Better together */}
        <Section
          id="together"
          eyebrow="better together"
          title="Useful alone, better with the rest"
          lede={`${content.name} works on its own. When other modules are in your workspace, they share one business context, so nothing is typed twice.`}
          tinted
        >
          <ul className="mt-10 grid gap-3 md:grid-cols-3">
            {content.connections.map((link) => (
              <li key={link.module} className="h-full">
                <Link
                  to={`/modules/${link.module}`}
                  className="group flex h-full items-start gap-3 rounded-md border bg-card p-5 shadow-card transition-all duration-300 ease-mosaic hover:-translate-y-1 hover:border-terminal-green/40 hover:shadow-pop"
                >
                  <ModuleChip id={link.module} className="size-9" />
                  <span>
                    <span className="flex items-center gap-1 font-mono text-small font-semibold">
                      {MODULE_LANDINGS[link.module].name}
                      <ArrowRight
                        aria-hidden="true"
                        className="size-3.5 transition-transform group-hover:translate-x-0.5"
                      />
                    </span>
                    <span className="mt-1 block font-mono text-caption text-muted-foreground">
                      {link.body}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>

        {/* Control and honesty */}
        <Section id="control" eyebrow="your control" title={content.guarantee.title}>
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <ScrollReveal preset="rise" className="h-full">
              <div className="h-full rounded-md border bg-card p-5 shadow-card">
                <ShieldCheck
                  aria-hidden="true"
                  className="size-5 text-terminal-green"
                />
                <p className="mt-3 font-mono text-small">
                  {content.guarantee.body}
                </p>
              </div>
            </ScrollReveal>
            {content.setupNote && (
              <ScrollReveal preset="rise" delay={0.07} className="h-full">
                <div className="h-full rounded-md border bg-card p-5 shadow-card">
                  <Info
                    aria-hidden="true"
                    className="size-5 text-terminal-amber"
                  />
                  <h3 className="mt-3 font-mono text-small font-medium">
                    Good to know
                  </h3>
                  <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                    {content.setupNote}
                  </p>
                </div>
              </ScrollReveal>
            )}
          </div>
        </Section>

        {/* Final action */}
        <section aria-labelledby="module-start-title" className="border-b">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-24">
            <ScrollReveal
              preset="scale"
              className="mx-auto max-w-2xl rounded-xl border bg-card p-8 text-center shadow-float sm:p-12"
            >
              <ModuleChip id={content.id} className="mx-auto mb-5 size-12" />
              <h2 id="module-start-title" className="font-mono text-h1">
                Start using {content.name}
              </h2>
              <p className="mx-auto mt-3 max-w-xl font-mono text-small text-muted-foreground">
                Sign in with an email code, name your project and add what your
                business does. {availability.label}.
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
            </ScrollReveal>
          </div>
        </section>

        {/* Other modules */}
        <nav aria-labelledby="other-modules-title" className="bg-dots">
          <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
            <h2
              id="other-modules-title"
              className="font-mono text-caption text-muted-foreground"
            >
              explore the other modules
            </h2>
            <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {others.map((m) => (
                <li key={m.id}>
                  <Link
                    to={`/modules/${m.id}`}
                    className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 font-mono text-caption font-medium transition-colors hover:border-terminal-green/40 hover:bg-accent"
                  >
                    <ModuleChip id={m.id} className="size-6" />
                    {m.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 font-mono text-caption text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span className="flex items-center gap-2">
            <MosaicMark size={16} />
            mosai · {content.name.toLowerCase()}
          </span>
          <span className="sm:ml-auto">
            drafts first, publishing only when you confirm it
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function ModuleLanding() {
  const { moduleId } = useParams();
  const content = moduleLanding(moduleId);

  useEffect(() => {
    if (content) document.title = `${content.name} · MOSAI`;
  }, [content]);

  // A new content page starts at the top, not at the previous scroll offset.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [moduleId]);

  if (!content) return <NotFound />;
  return <ModuleLandingView content={content} />;
}
