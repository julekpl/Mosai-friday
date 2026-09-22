import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
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
import { cn } from "@/lib/utils";

const modules = [
  { icon: Search, id: "understand", name: "understand", detail: "Personas, buyer profiles, journeys, evidence" },
  { icon: PenTool, id: "create", name: "create", detail: "Gaps, topics, briefs, content generation" },
  { icon: Blocks, id: "build", name: "build", detail: "Websites & apps generated with SEO/GEO/WCAG checks" },
  { icon: Users, id: "customers", name: "customers", detail: "CRM, consent, segments, mailing automations" },
  { icon: Megaphone, id: "promote", name: "promote", detail: "Campaigns, email, social, ads planning & execution" },
  { icon: ShoppingBag, id: "sell", name: "sell", detail: "Commerce, product feeds, billing/subscription" },
  { icon: TrendingUp, id: "grow", name: "grow", detail: "Analytics, insights, recommendations — sourced & dated" },
];

const bootLines = [
  { time: "00:00.12", text: "project.spine .......... loaded", ok: true },
  { time: "00:00.48", text: "personas.evidence ...... ready", ok: true },
  { time: "00:00.73", text: "content.briefs ......... linked", ok: true },
  { time: "00:01.05", text: "connections ............ ga4 · gsc · gads · meta", ok: true },
  { time: "00:01.31", text: "a11y.contrast .......... wcag 2.2 AA", ok: true },
  { time: "00:01.62", text: "modules ................ 7 ready", ok: true },
];

/** Types out the boot log line by line on mount, then loops. */
function useTypewriter() {
  const [visible, setVisible] = useState(0);
  const [chars, setChars] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const CHAR_MS = 9;
    const LINE_PAUSE = 110;
    const RESET_PAUSE = 2600;
    let line = 0;
    let char = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const text = bootLines[line]?.text ?? "";
      if (char <= text.length) {
        setVisible(line);
        setChars(char);
        char += 1;
        timer.current = setTimeout(tick, CHAR_MS);
      } else {
        if (line < bootLines.length - 1) {
          line += 1;
          char = 0;
          timer.current = setTimeout(tick, LINE_PAUSE);
        } else {
          timer.current = setTimeout(() => {
            line = 0;
            char = 0;
            setVisible(0);
            setChars(0);
            tick();
          }, RESET_PAUSE);
        }
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { visible, chars };
}

export default function Landing() {
  const { visible, chars } = useTypewriter();

  return (
    <div className="min-h-screen overflow-x-clip bg-background">
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
          <span className="hidden font-mono text-caption text-muted-foreground md:block">
            understand · create · build · customers · promote · sell · grow
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <a href="/auth">sign in</a>
            </Button>
            <Button asChild size="sm">
              <a href="/auth">start free</a>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b bg-grid">
        <FloatingTiles />
        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
          <p className="animate-mosaic-in font-mono text-caption text-terminal-green">
            ▸ mosai.init(project="yours") — ok
          </p>
          <h1 className="animate-mosaic-in mt-5 max-w-3xl font-mono text-display" style={{ animationDelay: "80ms" }}>
            One workspace from
            <br />
            persona to revenue
            <span className="animate-caret text-terminal-green">▌</span>
          </h1>
          <p
            className="animate-mosaic-in mt-4 max-w-2xl font-mono text-body text-muted-foreground"
            style={{ animationDelay: "160ms" }}
          >
            mosai connects the whole loop: understand your buyers, create the
            content, build the website or app, run campaigns, sell, and grow —
            each module works alone or together, on the plan you choose.
          </p>
          <div
            className="animate-mosaic-in mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "240ms" }}
          >
            <Button asChild size="lg" className="shadow-pop transition-transform duration-300 ease-mosaic hover:-translate-y-0.5 hover:scale-[1.02] active:translate-y-0 active:scale-95">
              <a href="/auth">
                Create your first project
                <ArrowRight className="size-4 transition-transform ease-mosaic group-hover:translate-x-0.5" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="transition-transform duration-300 ease-mosaic hover:-translate-y-0.5 hover:border-terminal-green/50 active:translate-y-0 active:scale-95">
              <a href="#modules">See the modules</a>
            </Button>
          </div>
          <div
            className="animate-mosaic-in mt-6 flex flex-wrap items-center gap-2 font-mono text-caption text-muted-foreground"
            style={{ animationDelay: "320ms" }}
          >
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
          <Reveal>
            <div className="overflow-hidden rounded-md border bg-card shadow-card">
              <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-1.5">
                <span className="size-2 rounded-full bg-terminal-green" />
                <span className="font-mono text-caption text-muted-foreground">
                  boot.log — phase 1
                </span>
                <span className="ml-auto font-mono text-caption text-muted-foreground/60">
                  replay in a moment…
                </span>
              </div>
              <div className="min-h-[196px] p-4 font-mono text-small">
                {bootLines.map((l, i) => {
                  const isActive = i === visible;
                  const isDone = i < visible;
                  if (!isActive && !isDone) return null;
                  const shown = isActive ? l.text.slice(0, chars) : l.text;
                  return (
                    <div key={l.time} className="flex items-baseline gap-3 py-0.5">
                      <span className="shrink-0 text-muted-foreground">{l.time}</span>
                      <span className="min-w-0 truncate">{shown}</span>
                      {isDone && (
                        <span className="ml-auto shrink-0 text-terminal-green">[ok]</span>
                      )}
                      {isActive && chars >= l.text.length && (
                        <span className="ml-auto shrink-0 text-terminal-green">[ok]</span>
                      )}
                      <span className="w-6 shrink-0" />
                    </div>
                  );
                })}
                <div className="flex items-baseline gap-3 pt-1 text-terminal-green">
                  <span>▸</span>
                  <span className="animate-caret">▌</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="border-b">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Reveal>
            <p className="font-mono text-caption text-terminal-green">▸ seven modules, one spine</p>
            <h2 className="mt-2 font-mono text-h1">Work together or separately</h2>
            <p className="mt-2 max-w-2xl font-mono text-small text-muted-foreground">
              Every project is the container: business details, channels,
              competitors, goals and KPIs, plus GA4, Search Console and social
              connections. Modules read from that same spine — pick only the
              ones your plan needs.
            </p>
          </Reveal>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {modules.map((m, i) => (
              <Reveal key={m.name} delay={i * 60}>
                <div
                  className={cn(
                    "group h-full rounded-md border bg-card p-4 shadow-card transition-all duration-300 ease-mosaic",
                    "hover:-translate-y-1 hover:rotate-[-0.4deg] hover:scale-[1.02] hover:shadow-pop",
                    "hover:border-terminal-green/40",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-9 place-items-center rounded-md transition-transform duration-300 ease-mosaic",
                      "group-hover:scale-110 group-hover:-rotate-6",
                    )}
                  >
                    <m.icon className={cn("size-5", moduleTileText(m.id))} />
                  </span>
                  <p className="mt-3 font-mono text-small font-medium">{m.name}</p>
                  <p className="mt-1 font-mono text-caption text-muted-foreground">
                    {m.detail}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-scanlines">
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
            <h2 className="font-mono text-h1">Start with a project</h2>
            <p className="mx-auto mt-2 max-w-xl font-mono text-small text-muted-foreground">
              Free plan includes Understand and Create. Connect GA4 and Search
              Console, build a persona, generate your first content brief — then
              add modules as you grow.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-6 shadow-pop transition-transform duration-300 ease-mosaic hover:-translate-y-0.5 hover:scale-[1.03] active:translate-y-0 active:scale-95"
            >
              <a href="/auth">
                Create your first project
                <ArrowRight className="size-4" />
              </a>
            </Button>
            <p className="mt-4 font-mono text-caption text-muted-foreground">
              every tile above is a module — place yours.
            </p>
          </Reveal>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 font-mono text-caption text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span className="flex items-center gap-2">
            <MosaicMark size={16} />
            mosai — understand · create · build · customers · promote · sell · grow
          </span>
          <span className="sm:ml-auto">modules work alone or together — your plan decides</span>
        </div>
      </footer>
    </div>
  );
}
