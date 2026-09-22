import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ArrowDownUp,
  ArrowUp,
  Bot,
  Calendar as CalendarIcon,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CloudUpload,
  Info,
  Loader2,
  Moon,
  RefreshCw,
  Search,
  Sparkles,
  SquarePen,
  Sun,
  TriangleAlert,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Calendar } from "@/components/ui/calendar";
import { Kbd } from "@/components/ui/kbd";

import {
  Demo,
  Section,
  SpecDoc,
  SpecRow,
  Swatch,
} from "@/components/system/section";
import {
  Sparkline,
  activity,
  adRows,
  integrations,
  metricCards,
  statusMeta,
} from "@/components/system/demo-data";
import { cn } from "@/lib/utils";

const navSections = [
  { id: "sec-00", label: "principles", range: "00" },
  { id: "sec-01", label: "foundations", range: "01–04" },
  { id: "sec-05", label: "components", range: "05–11" },
  { id: "sec-12", label: "patterns", range: "12" },
  { id: "sec-13", label: "inventory", range: "13–16" },
];

function StatusChip({ status }: { status: keyof typeof statusMeta }) {
  const meta = statusMeta[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-caption font-medium",
        meta.chip
      )}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {meta.label}
    </span>
  );
}

function PromptLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 font-mono text-caption text-muted-foreground">
      <span className="text-terminal-green">▸</span>
      {children}
    </div>
  );
}

export default function DesignSystem() {
  const [dark, setDark] = useState(false);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [density, setDensity] = useState([60]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        {/* ── Top bar ─────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
            <a href="/system" className="flex items-center gap-2 font-mono text-small font-semibold">
              <span className="grid size-6 place-items-center rounded-sm bg-primary text-primary-foreground text-caption">
                T
              </span>
              terminal<span className="text-terminal-green">/</span>1
            </a>
            <span className="hidden font-mono text-caption text-muted-foreground md:block">
              design system · v0.1 · phase 1
            </span>
            <nav className="ml-auto hidden items-center gap-1 lg:flex">
              {navSections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="rounded-sm px-2.5 py-1.5 font-mono text-caption text-muted-foreground hover:bg-accent hover:text-foreground ease-terminal"
                >
                  <span className="text-terminal-green">{s.range}</span> {s.label}
                </a>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle dark mode">
                {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
              <Button asChild size="sm">
                <a href="/">landing</a>
              </Button>
            </div>
          </div>
        </header>

        {/* ── Hero ────────────────────────────────────────────────────── */}
        <section className="border-b bg-grid">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
            <PromptLine>system.boot(design-language="terminal") — ok</PromptLine>
            <h1 className="mt-5 max-w-3xl font-mono text-display">
              The visual operating system
              <span className="text-terminal-green">_</span>
              <span className="animate-caret text-terminal-green">▌</span>
            </h1>
            <p className="mt-4 max-w-2xl font-mono text-body text-muted-foreground">
              A live component library for an ad-management platform — content
              generation, marketing automation and CRM on top of one calm,
              monospace foundation. Off-white surfaces, hairline borders,
              restrained green/amber status accents. Sophisticated underneath.
              Simple on the surface.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <a href="#sec-05">browse components</a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#sec-00">read principles</a>
              </Button>
              <div className="flex items-center gap-2 font-mono text-caption text-muted-foreground">
                <Kbd>tokens</Kbd>
                <Kbd>states</Kbd>
                <Kbd>motion</Kbd>
                <Kbd>a11y</Kbd>
              </div>
            </div>
          </div>
        </section>

        {/* ── Body: sticky side index + content ───────────────────────── */}
        <div className="mx-auto max-w-6xl gap-10 px-4 sm:px-6 lg:grid lg:grid-cols-[180px_1fr]">
          <aside className="hidden lg:block">
            <nav className="sticky top-20 flex flex-col gap-1 py-10">
              {navSections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="rounded-sm px-2 py-1.5 font-mono text-caption text-muted-foreground hover:bg-accent hover:text-foreground ease-terminal"
                >
                  <span className="text-terminal-green">{s.range}</span>{" "}
                  {s.label}
                </a>
              ))}
              <div className="mt-3 border-t pt-3 font-mono text-caption text-muted-foreground">
                16 sections · 60+ parts
                <br />
                phase 1 · no workflows
              </div>
            </nav>
          </aside>

          <main className="flex flex-col gap-16 py-12">
            {/* 00 · Principles */}
            <Section index="00" title="Design principles" note="what governs every decision">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["01", "Calm over clever", "Complexity is absorbed by the system, never shown to the user. Density with quiet: hairlines, whitespace, no competing chrome."],
                  ["02", "Ink first", "Structure comes from typography and 1px borders — not from shadows and fills. Color is reserved for meaning: green = go, amber = attention, red = fault."],
                  ["03", "Everything responds", "Every interactive surface has hover, focus, active and disabled states. Nothing dead. Nothing decorative-only."],
                  ["04", "Monospace with intent", "Monospace is the voice: technical, aligned, honest about data. Sizes and weights carry hierarchy, never a second typeface."],
                  ["05", "Motion communicates", "Animation explains causality — what opened, what saved, what changed. 120–200ms for controls, 200–300ms for surfaces. Reduced-motion collapses all of it."],
                  ["06", "Progressive disclosure", "Simple by default, powerful on demand. Secondary information sits behind popovers, inspectors and accordions — not on the canvas."],
                  ["07", "Real data, real density", "Components are built against dense tables, long labels and error text. No fake minimalism that breaks when real data arrives."],
                  ["08", "One coherent product", "Every module shares tokens, radius, spacing and motion. A user should never notice where one system ends and another begins."],
                ].map(([n, title, body]) => (
                  <Card key={n} className="shadow-card">
                    <CardHeader className="pb-3">
                      <CardDescription className="font-mono text-caption text-terminal-green">
                        [{n}]
                      </CardDescription>
                      <CardTitle className="font-mono text-h3">{title}</CardTitle>
                    </CardHeader>
                    <CardContent className="font-mono text-small text-muted-foreground">
                      {body}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </Section>

            {/* 01 · Typography */}
            <Section index="01" title="Typography" note="IBM Plex Mono · single family · weight carries hierarchy">
              <Demo spec="type scale" className="flex-col items-stretch">
                {[
                  ["display", "text-display", "Hero / marketing display", "The visual operating system"],
                  ["h1", "text-h1", "Page title", "Campaign performance"],
                  ["h2", "text-h2", "Section heading", "Connected channels"],
                  ["h3", "text-h3", "Card heading", "AI budget suggestions"],
                  ["body", "text-body", "Body copy", "Spend shifted +8.2% versus the previous 30-day window."],
                  ["small", "text-small", "Secondary copy / table cells", "4 campaigns · 12 ad sets · synced 09:41"],
                  ["caption", "text-caption tracking-wide", "Labels / metadata", "SYNCED 09:41 UTC"],
                  ["metric", "text-metric", "KPI numerals", "$53,655"],
                ].map(([name, cls, use, sample]) => (
                  <div key={name} className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-6">
                    <span className="w-32 shrink-0 font-mono text-caption text-terminal-green">{name}</span>
                    <span className={cn("grow", cls)}>{sample}</span>
                    <span className="hidden shrink-0 font-mono text-caption text-muted-foreground sm:block">{use}</span>
                  </div>
                ))}
              </Demo>
              <SpecDoc title="typography rules">
                <SpecRow name="family" value='IBM Plex Mono → ui-monospace stack' note="one family everywhere" />
                <SpecRow name="weights" value="400 / 500 / 600" note="no bold-er than 600" />
                <SpecRow name="min size" value="0.6875rem (caption)" note="never smaller, always uppercase+spaced" />
                <SpecRow name="numerics" value="tabular via mono metrics" note="columns align naturally" />
                <SpecRow name="line height" value="1.65 body / 1.05–1.35 headings" />
              </SpecDoc>
            </Section>

            {/* 02 · Color */}
            <Section index="02" title="Color tokens" note="semantic roles, not raw colors">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {[
                  ["background", "paper canvas"],
                  ["card", "raised paper"],
                  ["popover", "floating surface"],
                  ["muted", "subdued fill"],
                  ["foreground", "ink"],
                  ["muted-foreground", "secondary ink"],
                  ["border", "hairline"],
                  ["input", "control edge"],
                  ["primary", "ink control"],
                  ["accent", "hover wash"],
                  ["terminal-green", "go / ok / positive"],
                  ["terminal-amber", "attention / pending"],
                  ["terminal-red", "fault / destructive"],
                  ["terminal-blue", "informational"],
                ].map(([token, use]) => (
                  <div key={token} className="overflow-hidden rounded-md border">
                    <div
                      className="h-12 border-b"
                      style={{ background: `var(--${token})` }}
                    />
                    <div className="p-2">
                      <p className="font-mono text-caption font-medium">--{token}</p>
                      <p className="font-mono text-caption text-muted-foreground">{use}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Swatch name="--terminal-green-soft" value="var(--terminal-green-soft)" />
                <Swatch name="--terminal-amber-soft" value="var(--terminal-amber-soft)" />
              </div>
              <SpecDoc title="color rules">
                <SpecRow name="ratio" value="≥ 4.5:1 body ink, ≥ 3:1 large text & borders-of-meaning" note="WCAG 2.2 AA" />
                <SpecRow name="accents" value="green / amber / red / blue only as status" note="never decoration" />
                <SpecRow name="soft variants" value="*-soft tokens tint chips & banners" note="accent text always uses the strong token" />
                <SpecRow name="dark theme" value="full token parity from day one" note="see toggle, top right" />
              </SpecDoc>
            </Section>

            {/* 03 · Spacing + radius */}
            <Section index="03" title="Spacing & radius" note="4px base · no arbitrary values">
              <Demo spec="spacing scale (4px base)" className="flex-col items-stretch">
                {[
                  ["1", "4px", "inline gaps, icon padding"],
                  ["2", "8px", "chip padding, compact rows"],
                  ["3", "12px", "control padding, list gutters"],
                  ["4", "16px", "card padding, demo frames"],
                  ["6", "24px", "section gutters"],
                  ["8", "32px", "page gutters, section rhythm"],
                  ["12", "48px", "hero padding"],
                ].map(([tok, px, use]) => (
                  <div key={tok} className="flex items-center gap-4 border-b py-2 last:border-b-0">
                    <span className="w-10 font-mono text-caption text-terminal-green">{tok}</span>
                    <span className="h-3 rounded-xs bg-terminal-green/70" style={{ width: px }} />
                    <span className="font-mono text-caption text-muted-foreground">{px} — {use}</span>
                  </div>
                ))}
              </Demo>
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["radius-sm", "calc(r−4px) · chips, kbd"],
                  ["radius-md", "calc(r−2px) · controls"],
                  ["radius", "6px · cards, popovers"],
                ].map(([name, use]) => (
                  <div key={name} className="rounded-md border bg-card p-4 shadow-card">
                    <div className="mb-3 size-12 border bg-terminal-green-soft" style={{ borderRadius: "var(--radius)" }} />
                    <p className="font-mono text-small font-medium">{name}</p>
                    <p className="font-mono text-caption text-muted-foreground">{use}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* 04 · Elevation & texture */}
            <Section index="04" title="Elevation, blur & texture" note="depth is earned, not sprayed">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["shadow-hairline", "flat, outlined", "shadow-hairline"],
                  ["shadow-card", "resting card", "shadow-card"],
                  ["shadow-pop", "popover / dropdown", "shadow-pop"],
                  ["shadow-float", "modal / command", "shadow-float"],
                ].map(([name, use, cls]) => (
                  <div key={name} className={cn("rounded-md bg-card p-4", cls)}>
                    <p className="font-mono text-small font-medium">{name}</p>
                    <p className="font-mono text-caption text-muted-foreground">{use}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="bg-grid flex h-24 items-center justify-center rounded-md border font-mono text-caption text-muted-foreground">bg-grid · canvas</div>
                <div className="bg-dots flex h-24 items-center justify-center rounded-md border font-mono text-caption text-muted-foreground">bg-dots · workspace</div>
                <div className="bg-scanlines flex h-24 items-center justify-center rounded-md border font-mono text-caption text-muted-foreground">bg-scanlines · hero</div>
              </div>
              <SpecDoc title="elevation rules">
                <SpecRow name="blur" value="backdrop-blur only on the sticky top bar" note="context, not everywhere" />
                <SpecRow name="shadows" value="4-step scale; every step includes a 1px border" />
                <SpecRow name="z-index" value="dropdown 50 · sheet 50 · dialog 50 · toast 100" />
              </SpecDoc>
            </Section>

            {/* 05 · Buttons */}
            <Section index="05" title="Buttons & actions" note="primary = ink · destructive = red · all states present">
              <Demo spec="variants × sizes">
                <Button>Launch campaign</Button>
                <Button variant="outline">Preview</Button>
                <Button variant="secondary">Duplicate</Button>
                <Button variant="ghost">Dismiss</Button>
                <Button variant="link">View report</Button>
                <Button variant="destructive">Delete campaign</Button>
              </Demo>
              <Demo spec="sizes & icon buttons">
                <Button size="sm">Pause</Button>
                <Button size="default">Resume</Button>
                <Button size="lg">Create campaign</Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="Refresh sync">
                      <RefreshCw className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Re-sync channels</TooltipContent>
                </Tooltip>
                <Button disabled>Publish</Button>
                <Button disabled aria-busy="true">
                  <Loader2 className="size-4 animate-spin" />
                  Publishing…
                </Button>
              </Demo>
              <Demo spec="split + grouped actions">
                <div className="flex overflow-hidden rounded-md border">
                  <Button variant="outline" className="rounded-none border-0">
                    Approve
                  </Button>
                  <div className="w-px bg-border" />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="rounded-none border-0 px-2" aria-label="More approve actions">
                        ▾
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem>Approve & keep editing</DropdownMenuItem>
                      <DropdownMenuItem>Approve all pending</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <ToggleGroup type="single" defaultValue="7d" aria-label="Date range">
                  <ToggleGroupItem value="24h" aria-label="Last 24 hours">24h</ToggleGroupItem>
                  <ToggleGroupItem value="7d">7d</ToggleGroupItem>
                  <ToggleGroupItem value="30d">30d</ToggleGroupItem>
                </ToggleGroup>
                <Badge variant="outline" className="font-mono">status: neutral</Badge>
                <Badge className="border-terminal-green/40 bg-terminal-green-soft text-terminal-green font-mono">status: ok</Badge>
                <Badge className="border-terminal-amber/40 bg-terminal-amber-soft text-terminal-amber font-mono">status: warn</Badge>
              </Demo>
              <SpecDoc title="button states" defaultOpen={false}>
                <SpecRow name="default" value="ink fill / outlined / ghost" />
                <SpecRow name="hover" value="90% fill or accent wash, 120ms ease-terminal" />
                <SpecRow name="focus" value="3px ring var(--ring), offset via ring/50" note="always visible" />
                <SpecRow name="active" value="translate-y-0 — subtle darkened fill" />
                <SpecRow name="disabled" value="opacity-50 + pointer-events-none" />
                <SpecRow name="loading" value="spinner + verbatim action ('Publishing…')" note="aria-busy" />
              </SpecDoc>
            </Section>

            {/* 06 · Inputs */}
            <Section index="06" title="Inputs & controls" note="labels above · mono everywhere · validation inline">
              <Demo spec="text fields" className="flex-col items-stretch gap-4 sm:flex-row">
                <div className="grid flex-1 gap-2">
                  <Label htmlFor="camp">Campaign name</Label>
                  <Input id="camp" placeholder="e.g. Q3 Retargeting — Search" />
                </div>
                <div className="grid flex-1 gap-2">
                  <Label htmlFor="camp-err">Landing URL</Label>
                  <Input id="camp-err" defaultValue="nord://launch" aria-invalid="true" />
                  <p className="font-mono text-caption text-destructive">
                    Must be a full https:// URL
                  </p>
                </div>
              </Demo>
              <Demo spec="selection controls" className="items-start gap-8">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox id="r1" defaultChecked />
                    <Label htmlFor="r1">Sync audiences</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox id="r2" />
                    <Label htmlFor="r2">Auto-approve AI drafts</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="r3" defaultChecked />
                    <Label htmlFor="r3">Pause on budget cap</Label>
                  </div>
                </div>
                <RadioGroup defaultValue="auto" className="gap-3">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="auto" id="rg1" />
                    <Label htmlFor="rg1">Auto-distribute budget</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="manual" id="rg2" />
                    <Label htmlFor="rg2">Manual allocation</Label>
                  </div>
                </RadioGroup>
                <div className="flex flex-col gap-3">
                  <div className="grid gap-2">
                    <Label>Channel</Label>
                    <Select defaultValue="gads">
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="Pick one" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gads">Google Ads</SelectItem>
                        <SelectItem value="meta">Meta Ads</SelectItem>
                        <SelectItem value="li">LinkedIn Ads</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Daily cap</Label>
                    <div className="flex w-44 items-center gap-3">
                      <Slider value={density} onValueChange={setDensity} max={100} step={1} />
                      <span className="w-10 text-right font-mono text-caption">${density[0]}</span>
                    </div>
                  </div>
                </div>
              </Demo>
              <Demo spec="search + date picker" className="flex-col items-stretch gap-4 sm:flex-row sm:items-start">
                <div className="relative w-full max-w-xs flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Search campaigns…" className="pl-9" />
                  <Kbd className="absolute right-2 top-1/2 -translate-y-1/2">⌘K</Kbd>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-56 justify-start font-normal">
                      <CalendarIcon className="size-4" />
                      {date ? format(date, "MMM d, yyyy") : "Pick a flight date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={date} onSelect={setDate} />
                  </PopoverContent>
                </Popover>
              </Demo>
              <Demo spec="rich / AI prompt input" className="flex-col items-stretch">
                <Textarea placeholder="Describe the audience, angle and offer…" rows={3} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => toast.success("Draft queued", { description: "6 variants will be ready in ~40s." })}>
                    <Sparkles className="size-4" />
                    Generate variants
                  </Button>
                  <Button size="sm" variant="outline">Attach brand kit</Button>
                  <span className="ml-auto font-mono text-caption text-muted-foreground">128 / 400</span>
                  <Kbd>⏎</Kbd>
                </div>
              </Demo>
              <Demo spec="file upload" className="flex-col items-stretch">
                <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center">
                  <CloudUpload className="size-5 text-muted-foreground" />
                  <p className="font-mono text-small">Drop creatives here — PNG, MP4 up to 50MB</p>
                  <Button size="sm" variant="outline">Browse files</Button>
                </div>
              </Demo>
            </Section>

            {/* 07 · Cards & containers */}
            <Section index="07" title="Cards & containers" note="metrics · entity · AI suggestion · interactive">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {metricCards.map((m) => (
                  <Card key={m.id} className="shadow-card transition-shadow ease-terminal hover:shadow-pop">
                    <CardHeader className="pb-2">
                      <CardDescription className="font-mono text-caption tracking-wide">{m.label}</CardDescription>
                      <CardTitle className="font-mono text-metric">{m.value}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-end justify-between gap-2">
                      <div>
                        <span className={cn("font-mono text-small font-medium", m.up ? "text-terminal-green" : "text-terminal-amber")}>
                          {m.delta}
                        </span>
                        <span className="ml-2 font-mono text-caption text-muted-foreground">{m.sub}</span>
                      </div>
                      <div className="w-20">
                        <Sparkline data={m.spark} up={m.up} />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                <Card className="shadow-card">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardDescription className="font-mono text-caption tracking-wide">ENTITY CARD</CardDescription>
                      <StatusChip status="active" />
                    </div>
                    <CardTitle className="font-mono text-h3">SP — Search Exact</CardTitle>
                  </CardHeader>
                  <CardContent className="font-mono text-small text-muted-foreground">
                    Q3 Retargeting · Google Ads<br />
                    $12,480 spend · 4.82% CTR
                  </CardContent>
                  <CardFooter className="gap-2">
                    <Button size="sm" variant="outline">Open</Button>
                    <Button size="sm" variant="ghost">Pause</Button>
                  </CardFooter>
                </Card>
                <Card className="shadow-card border-terminal-blue/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2">
                      <Bot className="size-4 text-terminal-blue" />
                      <CardDescription className="font-mono text-caption tracking-wide">AI SUGGESTION</CardDescription>
                    </div>
                    <CardTitle className="font-mono text-h3">Shift $1,200 to Search</CardTitle>
                  </CardHeader>
                  <CardContent className="font-mono text-small text-muted-foreground">
                    Search Exact is converting at 2.4× Display over 7 days.
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">confidence 0.82</Badge>
                      <Badge variant="outline" className="font-mono">7d window</Badge>
                    </div>
                  </CardContent>
                  <CardFooter className="gap-2">
                    <Button size="sm">Apply</Button>
                    <Button size="sm" variant="ghost">Dismiss</Button>
                  </CardFooter>
                </Card>
                <Card className="shadow-card transition-colors ease-terminal hover:border-terminal-green/50">
                  <CardHeader className="pb-2">
                    <CardDescription className="font-mono text-caption tracking-wide">INTERACTIVE CARD</CardDescription>
                    <CardTitle className="font-mono text-h3">Always-On Prospecting</CardTitle>
                  </CardHeader>
                  <CardContent className="font-mono text-small text-muted-foreground">
                    Hover lifts border to accent — the whole card is clickable, not just the button.
                  </CardContent>
                  <CardFooter>
                    <span className="ml-auto flex items-center gap-1 font-mono text-caption text-terminal-green">
                      open <span>→</span>
                    </span>
                  </CardFooter>
                </Card>
              </div>
              <SpecDoc title="container rules">
                <SpecRow name="nesting" value="max 2 levels (card → chip), never card-in-card-in-card" />
                <SpecRow name="selection" value="border turns green, checkbox appears top-left" />
                <SpecRow name="loading" value="skeleton swap in place, no layout shift" />
              </SpecDoc>
            </Section>

            {/* 08 · Data display */}
            <Section index="08" title="Data display" note="dense tables · realistic copy · no fake minimalism">
              <Demo spec="campaign table — sortable, filterable, bulk-ready" className="flex-col items-stretch gap-3" bare>
                <div className="flex flex-wrap items-center gap-2 border-b p-3">
                  <div className="relative max-w-xs flex-1">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input placeholder="Filter rows…" className="h-8 pl-9 text-small" />
                  </div>
                  <Button variant="outline" size="sm">
                    <ArrowDownUp className="size-3.5" />
                    Spend
                    <ArrowUp className="size-3.5 text-terminal-green" />
                  </Button>
                  <Button variant="outline" size="sm">Channel ▾</Button>
                  <div className="ml-auto flex items-center gap-2">
                    <Badge variant="outline" className="font-mono">2 selected</Badge>
                    <Button size="sm" variant="outline">Pause</Button>
                    <Button size="sm" variant="ghost">Export</Button>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-9" />
                      <TableHead>Campaign</TableHead>
                      <TableHead className="hidden md:table-cell">Channel</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">CTR</TableHead>
                      <TableHead className="hidden lg:table-cell">7d</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {adRows.slice(0, 4).map((r) => (
                      <TableRow key={r.name}>
                        <TableCell>
                          <Checkbox aria-label={`Select ${r.name}`} />
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-small font-medium">{r.name}</div>
                          <div className="font-mono text-caption text-muted-foreground">{r.campaign}</div>
                        </TableCell>
                        <TableCell className="hidden font-mono text-caption md:table-cell">{r.channel}</TableCell>
                        <TableCell className="text-right font-mono text-small">{r.spend}</TableCell>
                        <TableCell className="hidden text-right font-mono text-small sm:table-cell">{r.ctr}</TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <div className="w-16">
                            <Sparkline data={r.trend} up={r.status !== "paused"} />
                          </div>
                        </TableCell>
                        <TableCell><StatusChip status={r.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
                  <span className="font-mono text-caption text-muted-foreground">1–4 of 128 rows</span>
                  <Pagination className="mx-0 w-auto">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious href="#" className="h-8 pl-2" />
                      </PaginationItem>
                      <PaginationItem><PaginationLink href="#" isActive className="h-8">1</PaginationLink></PaginationItem>
                      <PaginationItem><PaginationLink href="#" className="h-8">2</PaginationLink></PaginationItem>
                      <PaginationItem><PaginationLink href="#" className="h-8">3</PaginationLink></PaginationItem>
                      <PaginationItem>
                        <PaginationNext href="#" className="h-8 pr-2" />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </Demo>
              <div className="grid gap-3 md:grid-cols-2">
                <Demo spec="key–value + timeline" className="flex-col items-stretch">
                  <div className="grid grid-cols-2 gap-y-2 font-mono text-small">
                    <span className="text-muted-foreground">Budget</span><span>$2,000 / day</span>
                    <span className="text-muted-foreground">Flight</span><span>Sep 1 – Sep 30</span>
                    <span className="text-muted-foreground">Bid strategy</span><span>Target ROAS 3.5x</span>
                    <span className="text-muted-foreground">Data freshness</span><span className="text-terminal-green">synced 09:41</span>
                  </div>
                  <Separator className="my-2" />
                  {activity.slice(0, 3).map((a) => (
                    <div key={a.time} className="flex items-start gap-3 py-1.5">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-border" />
                      <div className="min-w-0">
                        <p className="truncate font-mono text-small">{a.what}</p>
                        <p className="font-mono text-caption text-muted-foreground">{a.time} · {a.who} · {a.detail}</p>
                      </div>
                    </div>
                  ))}
                </Demo>
                <Demo spec="processing / quota" className="flex-col items-stretch justify-center">
                  <div className="grid gap-3">
                    <div className="grid gap-1.5">
                      <div className="flex justify-between font-mono text-caption">
                        <span>Generation quota</span>
                        <span className="text-terminal-green">642 / 1,000</span>
                      </div>
                      <Progress value={64} />
                    </div>
                    <div className="grid gap-1.5">
                      <div className="flex justify-between font-mono text-caption">
                        <span>API rate window</span>
                        <span className="text-terminal-amber">890 / 1,000</span>
                      </div>
                      <Progress value={89} />
                    </div>
                    <div className="flex items-center gap-2 font-mono text-caption text-muted-foreground">
                      <Spinner className="size-3.5" />
                      syncing Meta — 2 of 4 ad accounts…
                    </div>
                  </div>
                </Demo>
              </div>
            </Section>

            {/* 09 · Feedback */}
            <Section index="09" title="Feedback & system status" note="specific copy — what happened, what's affected, what to do">
              <div className="grid gap-3 md:grid-cols-2">
                <Alert className="border-terminal-blue/40 bg-terminal-blue-soft/60">
                  <Info className="size-4 text-terminal-blue" />
                  <AlertTitle className="font-mono text-small">Scheduled maintenance</AlertTitle>
                  <AlertDescription className="font-mono text-caption">
                    LinkedIn Ads sync pauses Sun 02:00–03:00 UTC. No data is lost.
                  </AlertDescription>
                </Alert>
                <Alert className="border-terminal-amber/40 bg-terminal-amber-soft/60">
                  <TriangleAlert className="size-4 text-terminal-amber" />
                  <AlertTitle className="font-mono text-small">Meta token expires in 5 days</AlertTitle>
                  <AlertDescription className="font-mono text-caption">
                    Campaign sync for 2 accounts stops until reconnected.
                    <button className="ml-1 underline underline-offset-2">Reconnect Meta</button>
                  </AlertDescription>
                </Alert>
                <Alert variant="destructive" className="border-terminal-red/40 bg-terminal-red-soft/60">
                  <CircleAlert className="size-4" />
                  <AlertTitle className="font-mono text-small">Sync failed — rate limit</AlertTitle>
                  <AlertDescription className="font-mono text-caption">
                    LinkedIn returned 429 on 3 calls. Auto-retry at 10:00, or retry now.
                  </AlertDescription>
                </Alert>
                <Alert className="border-terminal-green/40 bg-terminal-green-soft/60">
                  <CircleCheck className="size-4 text-terminal-green" />
                  <AlertTitle className="font-mono text-small">Sync completed</AlertTitle>
                  <AlertDescription className="font-mono text-caption">
                    4 campaigns and 12 ad sets updated · 0 conflicts · 09:41 UTC.
                  </AlertDescription>
                </Alert>
              </div>
              <Demo spec="toasts — click to fire" className="flex-col items-start">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => toast.success("Budget updated", { description: "SP — Search Exact now $2,000/day." })}>
                    success toast
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toast.error("Publish failed", { description: "Creative 'Hero-15s.mp4' exceeds Meta's 4GB limit." })}>
                    error toast
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toast.warning("Unsaved changes", { description: "3 fields edited — save before leaving?" })}>
                    warning toast
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toast.info("Autosaved", { description: "All edits stored locally · 09:58." })}>
                    info toast
                  </Button>
                  <Button size="sm" variant="outline" onClick={() =>
                    toast("AI draft ready", {
                      description: "6 variants generated · confidence 0.82.",
                      action: { label: "Review", onClick: () => {} },
                    })
                  }>
                    with action
                  </Button>
                </div>
              </Demo>
              <Demo spec="skeletons & empty states" className="flex-col items-stretch">
                <div className="grid gap-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-20 w-full" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Empty className="border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><CircleDashed className="size-5" /></EmptyMedia>
                      <EmptyTitle className="font-mono text-h3">No campaigns yet</EmptyTitle>
                      <EmptyDescription className="font-mono text-caption">
                        Connect a channel, then create your first campaign — takes about 2 minutes.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent className="flex-row justify-center gap-2">
                      <Button size="sm">Connect Google Ads</Button>
                      <Button size="sm" variant="ghost">Import existing</Button>
                    </EmptyContent>
                  </Empty>
                  <Empty className="border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><Search className="size-5" /></EmptyMedia>
                      <EmptyTitle className="font-mono text-h3">0 results for "vegan"</EmptyTitle>
                      <EmptyDescription className="font-mono text-caption">
                        Nothing matches "vegan" in 128 campaigns. Clear filters or search a different term.
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent className="flex-row justify-center gap-2">
                      <Button size="sm" variant="outline">Clear filters</Button>
                    </EmptyContent>
                  </Empty>
                </div>
              </Demo>
              <Demo spec="permission + autosave states" className="flex-col items-stretch">
                <div className="grid gap-2 font-mono text-small">
                  <div className="flex items-center gap-2">
                    <TriangleAlert className="size-4 text-terminal-amber" />
                    Autosaved · <span className="text-muted-foreground">all changes stored locally — 09:58:12</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CircleAlert className="size-4 text-terminal-red" />
                    You have view-only access · <span className="text-muted-foreground">ask ops@nord for publish rights</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CloudUpload className="size-4 text-terminal-blue" />
                    Offline — queued edits will sync when you reconnect
                  </div>
                </div>
              </Demo>
            </Section>

            {/* 10 · Overlays */}
            <Section index="10" title="Overlays" note="popover < drawer < dialog — pick the lightest surface that works">
              <Demo spec="menus, sheets, dialogs, palette">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">Row actions ▾</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuLabel className="font-mono text-caption">SP — Search Exact</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>Duplicate</DropdownMenuItem>
                    <DropdownMenuItem>Share report</DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive">Delete…</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Sheet>
                  <SheetTrigger asChild>
                    <Button variant="outline">Open inspector</Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader>
                      <SheetTitle className="font-mono text-h3">SP — Search Exact</SheetTitle>
                      <SheetDescription className="font-mono text-caption">
                        Side panel for context without losing the list — inspect, tweak budget, return.
                      </SheetDescription>
                    </SheetHeader>
                    <div className="grid gap-3 p-4">
                      <div className="grid gap-2">
                        <Label htmlFor="bud">Daily budget</Label>
                        <Input id="bud" defaultValue="$2,000" />
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch id="on" defaultChecked />
                        <Label htmlFor="on">Active</Label>
                      </div>
                      <Button size="sm">Save changes</Button>
                    </div>
                  </SheetContent>
                </Sheet>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline">New campaign</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="font-mono text-h3">Create campaign</DialogTitle>
                      <DialogDescription className="font-mono text-caption">
                        Dialogs reserve focus for a single decision. Use popovers for anything lighter.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="nc">Name</Label>
                        <Input id="nc" placeholder="Q4 Prospecting — Search" />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm">Cancel</Button>
                      <Button size="sm">Create campaign</Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">Delete campaign</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle className="font-mono text-h3">Delete "Video — 15s Pre-roll"?</AlertDialogTitle>
                      <AlertDialogDescription className="font-mono text-caption">
                        This pauses delivery and removes its reports. Historical data stays recoverable for 30 days.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep campaign</AlertDialogCancel>
                      <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90">
                        Delete campaign
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </Demo>
              <Demo spec="command palette ⌘K" className="flex-col items-stretch" bare>
                <Command className="rounded-none border-0">
                  <CommandInput placeholder="Type a command or search…" />
                  <CommandList>
                    <CommandEmpty>No results found.</CommandEmpty>
                    <CommandGroup heading="Actions">
                      <CommandItem>
                        <Sparkles className="size-4" />
                        Generate ad variants
                        <CommandShortcut><Kbd>G</Kbd> <Kbd>E</Kbd></CommandShortcut>
                      </CommandItem>
                      <CommandItem>
                        <ArrowDownUp className="size-4" />
                        Rebalance budgets
                        <CommandShortcut><Kbd>⌘</Kbd><Kbd>B</Kbd></CommandShortcut>
                      </CommandItem>
                      <CommandItem>
                        <RefreshCw className="size-4" />
                        Re-sync all channels
                      </CommandItem>
                    </CommandGroup>
                  </CommandList>
                </Command>
              </Demo>
            </Section>

            {/* 11 · AI-native */}
            <Section index="11" title="AI-native patterns" note="integrated, never bolted on · human approves">
              <Demo spec="generated output + accept / reject / regenerate" className="flex-col items-stretch">
                <Card className="border-terminal-blue/30 shadow-card">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bot className="size-4 text-terminal-blue" />
                        <CardDescription className="font-mono text-caption tracking-wide">AI DRAFT · agent-03</CardDescription>
                      </div>
                      <Badge variant="outline" className="font-mono">confidence 0.82</Badge>
                    </div>
                    <CardTitle className="font-mono text-h3">6 variants · Q3 Retargeting</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 font-mono text-small">
                    <div className="rounded-sm border-l-2 border-terminal-green/60 bg-terminal-green-soft/50 px-3 py-2">
                      + Retire the commute, not the coffee. 15% off your first month.
                    </div>
                    <div className="rounded-sm border-l-2 border-terminal-red/50 bg-terminal-red-soft/40 px-3 py-2 line-through opacity-70">
                      − Cheapest ads on the internet, click now!!
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button size="sm">Accept all</Button>
                      <Button size="sm" variant="outline">Edit with AI</Button>
                      <Button size="sm" variant="ghost"><RefreshCw className="size-3.5" /> Regenerate</Button>
                      <Button size="sm" variant="ghost"><Undo2 className="size-3.5" /> Undo</Button>
                    </div>
                  </CardContent>
                  <CardFooter className="font-mono text-caption text-muted-foreground">
                    sources: performance_30d.csv · brand_voice.md · 2 web citations
                  </CardFooter>
                </Card>
              </Demo>
              <Demo spec="generation in progress + suggested prompts" className="flex-col items-stretch">
                <div className="flex flex-wrap items-center gap-2 font-mono text-caption text-muted-foreground">
                  <SquarePen className="size-3.5 text-terminal-blue" />
                  writing variant 4 of 6
                  <span className="inline-flex gap-1">
                    <span className="size-1.5 animate-bounce rounded-full bg-terminal-green [animation-delay:0ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-terminal-green [animation-delay:120ms]" />
                    <span className="size-1.5 animate-bounce rounded-full bg-terminal-green [animation-delay:240ms]" />
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["Best-performing angle", "Seasonal hook", "Compare plans", "Draft from top URL"].map((s) => (
                    <Button key={s} variant="outline" size="sm" className="rounded-full font-mono text-caption">
                      {s}
                    </Button>
                  ))}
                </div>
              </Demo>
            </Section>

            {/* 12 · Integrations */}
            <Section index="12" title="Integration patterns" note="connect · status · sync · failure — UI only, no live APIs in phase 1">
              <Demo spec="channel connections" className="flex-col items-stretch">
                {integrations.map((i) => (
                  <div key={i.name} className="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0">
                    <span
                      className={cn(
                        "size-2 shrink-0 rounded-full",
                        i.status === "connected" && "bg-terminal-green",
                        i.status === "error" && "bg-terminal-red",
                        i.status === "available" && "border border-input bg-transparent"
                      )}
                      aria-hidden
                    />
                    <span className="font-mono text-small font-medium">{i.name}</span>
                    <span className="font-mono text-caption text-muted-foreground">{i.detail}</span>
                    <span className="ml-auto">
                      {i.status === "connected" && (
                        <Button size="sm" variant="ghost">Configure</Button>
                      )}
                      {i.status === "error" && (
                        <Button size="sm" variant="outline" className="border-terminal-amber/50 text-terminal-amber">
                          Reconnect
                        </Button>
                      )}
                      {i.status === "available" && (
                        <Button size="sm" variant="outline">Connect {i.name.split(" ")[0]}</Button>
                      )}
                    </span>
                  </div>
                ))}
              </Demo>
              <SpecDoc title="integration surface (future-proofing)">
                <SpecRow name="connection flow" value="OAuth screen → permission summary → test connection → sync schedule" note="patterns reserved" />
                <SpecRow name="mapping" value="field-mapping tables reuse the table pattern in §08" />
                <SpecRow name="failure" value="banners (§09) + reconnect CTA; never dead-end the user" />
                <SpecRow name="keys" value="masked inputs with copy + last-used meta" />
              </SpecDoc>
            </Section>

            {/* 13 · Inventory */}
            <Section index="13" title="Component inventory" note="primitive → composite → pattern → screen">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["primitives", "button, input, select, checkbox, radio, switch, slider, label, badge, kbd, avatar, separator, skeleton, tooltip, icon"],
                  ["composites", "button group, input group, form field, status chip, metric card, entity card, data table, pagination, command palette, date picker, file drop, prompt box"],
                  ["patterns", "master-detail, inspector panel, filters + bulk actions, empty states, sync/status banner, AI review flow, connection list, audit timeline"],
                  ["future screens", "campaign manager, content studio, automation builder, CRM inbox, settings & integrations"],
                ].map(([tier, items]) => (
                  <Card key={tier} className="shadow-card">
                    <CardHeader className="pb-2">
                      <CardDescription className="font-mono text-caption text-terminal-green">{tier}</CardDescription>
                    </CardHeader>
                    <CardContent className="font-mono text-caption text-muted-foreground">{items}</CardContent>
                  </Card>
                ))}
              </div>
              <SpecDoc title="component spec contract — every major part ships with">
                <SpecRow name="1–4" value="purpose · when to use · when not · anatomy" />
                <SpecRow name="5–7" value="variants · sizes · full state matrix" />
                <SpecRow name="8–10" value="interaction rules · a11y requirements · responsive behavior" />
                <SpecRow name="11–15" value="animation · loading · empty · error · content rules" />
              </SpecDoc>
            </Section>

            {/* 14 · Motion */}
            <Section index="14" title="Motion system" note="fast controls, gentle surfaces, zero bounce">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  ["120ms", "controls", "duration-100 ease-terminal"],
                  ["200ms", "surfaces", "duration-200 ease-terminal"],
                  ["300ms", "overlays", "duration-300 ease-terminal"],
                ].map(([ms, use, cls]) => (
                  <div
                    key={ms}
                    className={cn(
                      "group cursor-default rounded-md border bg-card p-4 transition-all hover:border-terminal-green/60 hover:shadow-pop",
                      cls
                    )}
                  >
                    <p className="font-mono text-metric group-hover:text-terminal-green">{ms}</p>
                    <p className="font-mono text-caption text-muted-foreground">{use} — hover me</p>
                  </div>
                ))}
              </div>
              <SpecDoc title="motion spec">
                <SpecRow name="durations" value="120ms controls · 200ms surfaces/tabs · 300ms overlays/entrance" />
                <SpecRow name="easing" value="ease-terminal = cubic-bezier(0.22, 1, 0.36, 1)" note="decelerate, no bounce" />
                <SpecRow name="entrance" value="fade + 4px rise on mount; exit is instant for controls" />
                <SpecRow name="layout" value="expand/collapse animates height; lists animate opacity only" />
                <SpecRow name="reduced motion" value="all durations collapse to ~0ms; content appears instantly" note="enforced globally" />
              </SpecDoc>
            </Section>

            {/* 15 · Responsive */}
            <Section index="15" title="Responsive behavior" note="components transform, they don't shrink">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {metricCards.slice(0, 4).map((m) => (
                  <Card key={m.id} className="shadow-card sm:shadow-none">
                    <CardContent className="p-4">
                      <p className="font-mono text-caption text-muted-foreground">{m.label}</p>
                      <p className="font-mono text-metric">{m.value}</p>
                      <div className="mt-1"><Sparkline data={m.spark} up={m.up} /></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <SpecDoc title="breakpoint rules">
                <SpecRow name="base → sm ≥640" value="metrics stack 1-col; table hides CTR/7d; nav collapses to top bar" />
                <SpecRow name="md ≥768" value="2-col metric grid; sidebar becomes icon rail; inspector becomes sheet" />
                <SpecRow name="lg ≥1024" value="3-col; sticky docs index (like this page) appears" />
                <SpecRow name="xl ≥1280" value="4-col metrics; full master-detail with inline inspector" />
                <SpecRow name="touch" value="min target 44px; hover-only affordances gain visible buttons" />
              </SpecDoc>
            </Section>

            {/* 16 · Accessibility */}
            <Section index="16" title="Accessibility" note="WCAG 2.2 AA is a floor, not a stretch goal">
              <Demo spec="built into every component" className="flex-col items-stretch">
                <div className="grid gap-2 font-mono text-small sm:grid-cols-2">
                  {[
                    "Visible 3px focus ring on every interactive element",
                    "Keyboard: tab order, ⌘K palette, esc closes overlays",
                    "aria-busy on loading buttons, role=alert on errors",
                    "Labels bound with htmlFor; errors reference the field",
                    "Touch targets ≥ 44px on coarse pointers",
                    "Status never conveyed by color alone — dot + text",
                    "prefers-reduced-motion collapses all animation",
                    "Semantic landmarks: header/nav/main/section/table",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2">
                      <span className="grid size-4 shrink-0 place-items-center rounded-xs border border-terminal-green/60 bg-terminal-green-soft">
                        <Check className="size-3 text-terminal-green" />
                      </span>
                      {item}
                    </div>
                  ))}
                </div>
              </Demo>
              <SpecDoc title="contrast audit (light theme)" defaultOpen={false}>
                <SpecRow name="foreground on background" value="≈ 13.9:1" note="AAA" />
                <SpecRow name="terminal-green on background" value="≈ 4.6:1" note="AA for text, AAA for large/borders" />
                <SpecRow name="terminal-amber on background" value="≈ 3.4:1" note="AA large / non-text; paired with text labels" />
                <SpecRow name="muted-foreground on background" value="≈ 7.1:1" note="AAA" />
              </SpecDoc>
            </Section>

            {/* Footer */}
            <footer className="flex flex-col gap-2 border-t pt-8 pb-16 font-mono text-caption text-muted-foreground">
              <PromptLine>
                phase 1 complete — foundations + component library live. awaiting phase 2 product spec.
              </PromptLine>
              <p>terminal/1 design system · tokens, states & motion are contract · components compose: primitive → composite → pattern → screen</p>
            </footer>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
