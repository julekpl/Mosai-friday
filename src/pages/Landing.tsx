import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Blocks,
  Megaphone,
  PenTool,
  Search,
  ShoppingBag,
  TrendingUp,
  Users,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const modules = [
  {
    icon: Search,
    name: "understand",
    detail: "Personas, buyer profiles, journeys, evidence",
  },
  {
    icon: PenTool,
    name: "create",
    detail: "Gaps, topics, briefs, content generation",
  },
  {
    icon: Blocks,
    name: "build",
    detail: "Websites & apps generated with SEO/GEO/WCAG checks",
  },
  {
    icon: Users,
    name: "customers",
    detail: "CRM, consent, segments, mailing automations",
  },
  {
    icon: Megaphone,
    name: "promote",
    detail: "Campaigns, email, social, ads planning & execution",
  },
  {
    icon: ShoppingBag,
    name: "sell",
    detail: "Commerce, product feeds, billing/subscription",
  },
  {
    icon: TrendingUp,
    name: "grow",
    detail: "Analytics, insights, recommendations — sourced & dated",
  },
];

const bootLines = [
  { time: "00:00.12", text: "project.spine .......... loaded", ok: true },
  { time: "00:00.48", text: "personas.evidence ...... ready", ok: true },
  { time: "00:00.73", text: "content.briefs ......... linked", ok: true },
  { time: "00:01.05", text: "connections ............ ga4 · gsc · gads · meta", ok: true },
  { time: "00:01.31", text: "a11y.contrast .......... wcag 2.2 AA", ok: true },
  { time: "00:01.62", text: "modules ................ 7 ready", ok: true },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2 font-mono text-small font-semibold">
            <span className="grid size-6 place-items-center rounded-sm bg-primary text-primary-foreground text-caption">
              M
            </span>
            mosai
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
      <section className="border-b bg-grid">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
          <p className="font-mono text-caption text-terminal-green">
            ▸ mosai.init(project="yours") — ok
          </p>
          <h1 className="mt-5 max-w-3xl font-mono text-display">
            One workspace from
            <br />
            persona to revenue
            <span className="animate-caret text-terminal-green">▌</span>
          </h1>
          <p className="mt-4 max-w-2xl font-mono text-body text-muted-foreground">
            mosai connects the whole loop: understand your buyers, create the
            content, build the website or app, run campaigns, sell, and grow —
            each module works alone or together, on the plan you choose.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <a href="/auth">
                Create your first project
                <ArrowRight className="size-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#modules">See the modules</a>
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
          <p className="font-mono text-caption text-terminal-green">▸ seven modules, one spine</p>
          <h2 className="mt-2 font-mono text-h1">Work together or separately</h2>
          <p className="mt-2 max-w-2xl font-mono text-small text-muted-foreground">
            Every project is the container: business details, channels,
            competitors, goals and KPIs, plus GA4, Search Console and social
            connections. Modules read from that same spine — pick only the ones
            your plan needs.
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
          <h2 className="font-mono text-h1">Start with a project</h2>
          <p className="mx-auto mt-2 max-w-xl font-mono text-small text-muted-foreground">
            Free plan includes Understand and Create. Connect GA4 and Search
            Console, build a persona, generate your first content brief — then
            add modules as you grow.
          </p>
          <Button asChild size="lg" className="mt-6">
            <a href="/auth">
              Create your first project
              <ArrowRight className="size-4" />
            </a>
          </Button>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 font-mono text-caption text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span>mosai — understand · create · build · customers · promote · sell · grow</span>
          <span className="sm:ml-auto">modules work alone or together — your plan decides</span>
        </div>
      </footer>
    </div>
  );
}
