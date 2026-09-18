import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── Module tile palette ───────────────────────────────────────────────── */
/** Each module owns one tile colour — the mosaic identity. */
export const MODULE_TILES = {
  understand: "teal",
  journeys: "sky",
  create: "violet",
  build: "coral",
  customers: "rose",
  promote: "amber",
  sell: "lime",
  grow: "teal",
} as const;

export type TileName = (typeof MODULE_TILES)[keyof typeof MODULE_TILES] | "amber";

const TILE_COLOR: Record<TileName, string> = {
  teal: "text-tile-teal",
  coral: "text-tile-coral",
  violet: "text-tile-violet",
  sky: "text-tile-sky",
  rose: "text-tile-rose",
  lime: "text-tile-lime",
  amber: "text-tile-amber",
};

const TILE_SOFT_BG: Record<TileName, string> = {
  teal: "bg-tile-teal-soft text-tile-teal",
  coral: "bg-tile-coral-soft text-tile-coral",
  violet: "bg-tile-violet-soft text-tile-violet",
  sky: "bg-tile-sky-soft text-tile-sky",
  rose: "bg-tile-rose-soft text-tile-rose",
  lime: "bg-tile-lime-soft text-tile-lime",
  amber: "bg-tile-amber-soft text-tile-amber",
};

/** Solid tile background, resolved statically so Tailwind can see every class. */
const TILE_SOLID_BG: Record<TileName, string> = {
  teal: "bg-tile-teal",
  coral: "bg-tile-coral",
  violet: "bg-tile-violet",
  sky: "bg-tile-sky",
  rose: "bg-tile-rose",
  lime: "bg-tile-lime",
  amber: "bg-tile-amber",
};

/** Icon tint for a module id (falls back to terminal green). */
export function moduleTileText(moduleId: string): string {
  const tile = MODULE_TILES[moduleId as keyof typeof MODULE_TILES];
  return tile ? TILE_COLOR[tile] : "text-terminal-green";
}

/** Soft chip style for a module id. */
export function moduleTileChip(moduleId: string): string {
  const tile = MODULE_TILES[moduleId as keyof typeof MODULE_TILES];
  return tile ? TILE_SOFT_BG[tile] : "bg-terminal-green-soft text-terminal-green";
}

/** Solid tile background class for a module id. */
export function moduleTileBg(moduleId: string): string {
  const tile = MODULE_TILES[moduleId as keyof typeof MODULE_TILES];
  return tile ? TILE_SOLID_BG[tile] : "bg-terminal-green";
}

/* ── MosaicMark: the animated 4-tile logo ──────────────────────────────── */
/**
 * The mosai mark — a 2×2 mosaic of tiles that pop in one by one on mount
 * and gently float forever. Reads on light and dark paper.
 */
export function MosaicMark({
  size = 24,
  className,
  interactive = false,
}: {
  size?: number;
  className?: string;
  /** Adds a springy hover scatter — use where the logo is clickable. */
  interactive?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-grid shrink-0 grid-cols-2 gap-[2px]",
        interactive &&
          "transition-transform duration-300 ease-mosaic hover:rotate-6 hover:scale-110",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span
        className="animate-mosaic-pop rounded-[2px] bg-tile-teal"
        style={{ animationDelay: "0ms" }}
      />
      <span
        className="animate-mosaic-pop rounded-[2px] bg-tile-coral"
        style={{ animationDelay: "90ms" }}
      />
      <span
        className="animate-mosaic-pop rounded-[2px] bg-tile-violet"
        style={{ animationDelay: "180ms" }}
      />
      <span
        className="animate-mosaic-pop rounded-[2px] bg-tile-lime"
        style={{ animationDelay: "270ms" }}
      />
    </span>
  );
}

/* ── Reveal on scroll ──────────────────────────────────────────────────── */
/** Fades + rises children into view once, using IntersectionObserver. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all duration-700 ease-mosaic",
        shown
          ? "translate-y-0 opacity-100"
          : "translate-y-6 opacity-0",
        className,
      )}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ── Floating tile field (ambient background) ──────────────────────────── */
const FLOATING_TILES: Array<{
  tile: TileName;
  size: number;
  top: string;
  left: string;
  delay: string;
  duration: string;
  rotate: number;
}> = [
  { tile: "teal", size: 90, top: "6%", left: "4%", delay: "0s", duration: "8s", rotate: 8 },
  { tile: "coral", size: 46, top: "16%", left: "88%", delay: "0.8s", duration: "9s", rotate: -12 },
  { tile: "violet", size: 64, top: "68%", left: "7%", delay: "1.6s", duration: "10s", rotate: -6 },
  { tile: "lime", size: 38, top: "78%", left: "80%", delay: "0.4s", duration: "7.5s", rotate: 14 },
  { tile: "sky", size: 54, top: "40%", left: "94%", delay: "2.2s", duration: "9.5s", rotate: 6 },
  { tile: "rose", size: 30, top: "48%", left: "2%", delay: "1.1s", duration: "8.5s", rotate: -14 },
];

/** Soft, blurred, slowly floating tiles for hero/auth backgrounds. */
export function FloatingTiles({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      {FLOATING_TILES.map((t, i) => (
        <span
          key={i}
          className={cn(
            "absolute animate-mosaic-float rounded-lg opacity-[0.16] blur-md",
            TILE_SOLID_BG[t.tile],
          )}
          style={{
            width: t.size,
            height: t.size,
            top: t.top,
            left: t.left,
            animationDelay: t.delay,
            animationDuration: t.duration,
            transform: `rotate(${t.rotate}deg)`,
          }}
        />
      ))}
    </div>
  );
}
