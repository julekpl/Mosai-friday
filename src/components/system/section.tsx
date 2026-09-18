import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Numbered documentation section with sticky terminal-style header. */
export function Section({
  index,
  title,
  note,
  children,
}: {
  index: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section id={`sec-${index}`} className="scroll-mt-24">
      <header className="flex items-baseline gap-3 border-b pb-3">
        <span className="font-mono text-caption text-terminal-green">[{index}]</span>
        <h2 className="font-mono text-h2">{title}</h2>
        {note && (
          <span className="hidden font-mono text-caption text-muted-foreground sm:block">
            {note}
          </span>
        )}
      </header>
      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </section>
  );
}

/** Framed demo area with a `$ spec:` prompt line and optional caption. */
export function Demo({
  spec,
  children,
  className,
  bare = false,
}: {
  spec: string;
  children: ReactNode;
  className?: string;
  bare?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-md border bg-card shadow-card">
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-1.5">
        <span className="font-mono text-caption text-terminal-green">$</span>
        <span className="truncate font-mono text-caption text-muted-foreground">
          spec: {spec}
        </span>
      </div>
      <div
        className={cn(
          !bare && "flex flex-wrap items-center gap-3 p-4",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** One name → value → notes row of a specification table. */
export function SpecRow({
  name,
  value,
  note,
}: {
  name: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-1 border-b py-2 last:border-b-0 sm:grid-cols-[minmax(9rem,14rem)_1fr]">
      <span className="font-mono text-small font-medium">{name}</span>
      <span className="font-mono text-small text-muted-foreground">
        {value}
        {note && <span className="text-terminal-green"> — {note}</span>}
      </span>
    </div>
  );
}

/** Collapsible spec panel; open by default so the docs are visible. */
export function SpecDoc({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent ease-terminal"
      >
        <ChevronRight
          className={cn(
            "size-3.5 text-muted-foreground transition-transform ease-terminal",
            open && "rotate-90"
          )}
        />
        <span className="font-mono text-small font-medium">{title}</span>
      </button>
      {open && (
        <div className="border-t px-3 py-2">{children}</div>
      )}
    </div>
  );
}

/** Color token swatch with name and value. */
export function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <div className="h-14 border-b" style={{ background: value }} />
      <div className="p-2">
        <p className="font-mono text-caption font-medium">{name}</p>
        <p className="font-mono text-caption text-muted-foreground">{value}</p>
      </div>
    </div>
  );
}
