import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PageDocument } from "@/lib/cms/blocks";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { sanitizeHtml } from "@/lib/sanitize";

/**
 * Renders a PageDocument against the W1 block registry. This is the same
 * render contract the future public runtime (W3) will use — structured data
 * in, semantic HTML out. Never HTML-as-truth.
 */
export function PageRenderer({ doc }: { doc: PageDocument }) {
  if (!doc?.blocks?.length) {
    return (
      <p className="rounded-md border border-dashed p-8 text-center font-mono text-caption text-muted-foreground">
        Empty page — add sections in the editor.
      </p>
    );
  }
  return (
    <article className="grid gap-10">
      {doc.blocks.map((b) => (
        <BlockView key={b.id} type={b.type} props={b.props} />
      ))}
    </article>
  );
}

function BlockView({
  type,
  props,
}: {
  type: string;
  props: Record<string, unknown>;
}) {
  switch (type) {
    case "hero": {
      const align = props.align === "center" ? "text-center mx-auto" : "";
      return (
        <section className={`grid gap-3 py-6 ${align}`}>
          {props.eyebrow ? (
            <p className="font-mono text-caption uppercase tracking-widest text-terminal-green">
              {String(props.eyebrow)}
            </p>
          ) : null}
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight">
            {String(props.heading ?? "")}
          </h1>
          {props.body ? (
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {String(props.body)}
            </p>
          ) : null}
          {props.ctaLabel && props.ctaHref ? (
            <span className="mt-1 inline-flex w-fit items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              {String(props.ctaLabel)}
            </span>
          ) : null}
        </section>
      );
    }
    case "richText":
      return (
        <section
          className="prose prose-sm max-w-none"
          // sanitized via the shared allow-list before injection (T0.7)
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(props.html) }}
        />
      );
    case "image":
      return (
        <figure className="grid gap-1.5">
          {props.assetId ? (
            <img
              src={String(props.assetUrl ?? "")}
              alt={String(props.alt ?? "")}
              className="max-h-80 w-full rounded-md border object-cover"
            />
          ) : (
            <div className="grid h-40 place-items-center rounded-md border border-dashed font-mono text-caption text-muted-foreground">
              no image selected
            </div>
          )}
          {props.caption ? (
            <figcaption className="font-mono text-caption text-muted-foreground">
              {String(props.caption)}
            </figcaption>
          ) : null}
        </figure>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-terminal-green pl-4">
          <p className="text-sm italic leading-relaxed">{String(props.text ?? "")}</p>
          {props.attribution ? (
            <cite className="mt-1 block font-mono text-caption not-italic text-muted-foreground">
              — {String(props.attribution)}
            </cite>
          ) : null}
        </blockquote>
      );
    case "cta":
      return (
        <section className="rounded-md border bg-card p-6 shadow-card">
          <h2 className="text-lg font-semibold">{String(props.heading ?? "")}</h2>
          {props.body ? (
            <p className="mt-1 text-sm text-muted-foreground">{String(props.body)}</p>
          ) : null}
          <span className="mt-3 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            {String(props.buttonLabel ?? "")}
          </span>
        </section>
      );
    case "featureGrid": {
      const items = Array.isArray(props.items) ? props.items : [];
      return (
        <section className="grid gap-3">
          {props.heading ? (
            <h2 className="text-lg font-semibold">{String(props.heading)}</h2>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((it: { title?: string; body?: string }, i: number) => (
              <div key={i} className="rounded-md border bg-card p-4 shadow-card">
                <p className="font-mono text-small font-medium">{it?.title ?? ""}</p>
                {it?.body ? (
                  <p className="mt-1 font-mono text-caption text-muted-foreground">
                    {it.body}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      );
    }
    case "faq": {
      const items = Array.isArray(props.items) ? props.items : [];
      return (
        <section className="grid gap-3">
          {props.heading ? (
            <h2 className="text-lg font-semibold">{String(props.heading)}</h2>
          ) : null}
          {items.map((it: { question?: string; answer?: string }, i: number) => (
            <div key={i} className="rounded-md border bg-card p-4 shadow-card">
              <p className="font-mono text-small font-medium">{it?.question ?? ""}</p>
              <p className="mt-1 font-mono text-caption text-muted-foreground">
                {it?.answer ?? ""}
              </p>
            </div>
          ))}
        </section>
      );
    }
    case "stats": {
      const items = Array.isArray(props.items) ? props.items : [];
      return (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((it: { value?: string; label?: string }, i: number) => (
            <div key={i} className="rounded-md border bg-card p-4 text-center shadow-card">
              <p className="font-mono text-metric text-terminal-green">{it?.value ?? ""}</p>
              <p className="font-mono text-caption text-muted-foreground">{it?.label ?? ""}</p>
            </div>
          ))}
        </section>
      );
    }
    case "divider":
      return <hr className="border-border" />;
    case "spacer":
      return <div style={{ height: Math.min(Number(props.height ?? 48), 200) }} />;
    case "productGrid": {
      return <ProductGridBlock
        collectionId={props.collectionId ? String(props.collectionId) : null}
        columns={Number(props.columns ?? 3)}
      />;
    }
    default:
      return (
        <div className="rounded-md border border-terminal-amber/40 bg-terminal-amber-soft p-4 font-mono text-caption text-terminal-amber">
          Unknown block "{type}" — this version needs a migration.
        </div>
      );
  }
}

/* ── ProductGrid: resolves live Sell data (§50) — never stored on the page ── */

type ResolvedProduct = {
  productId: string;
  title: string;
  priceCents: number | null;
  currency: string;
  availability: string | null;
  imageUrl: string | null;
  externalUrl: string | null;
  provider: string | null;
};

function ProductGridBlock({
  collectionId,
  columns,
}: {
  collectionId: string | null;
  columns: number;
}) {
  const cols = Math.min(Math.max(columns, 1), 4);
  const products = useQuery(
    api.cms.resolveProducts,
    collectionId
      ? { collectionId: collectionId as Id<"collections">, limit: 12 }
      : "skip",
  ) as ResolvedProduct[] | undefined;

  if (!collectionId) {
    return (
      <section className="rounded-md border border-dashed p-6 font-mono text-caption text-muted-foreground">
        Product grid — no collection selected yet.
      </section>
    );
  }
  if (products === undefined) {
    return (
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-40 animate-pulse rounded-md border bg-muted" />
        ))}
      </div>
    );
  }
  if (products.length === 0) {
    return (
      <section className="rounded-md border border-terminal-amber/40 bg-terminal-amber-soft p-4 font-mono text-caption text-terminal-amber">
        This collection has no products — sync the catalog or add products in Sell.
      </section>
    );
  }
  return (
    <section className="grid gap-3">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {products.map((p) => (
          <ProductCard key={p.productId} product={p} />
        ))}
      </div>
    </section>
  );
}

function ProductCard({ product }: { product: ResolvedProduct }) {
  const outOfStock = product.availability === "out_of_stock";
  return (
    <div className="grid gap-2 rounded-md border bg-card p-3 shadow-card">
      <div className="grid h-32 place-items-center overflow-hidden rounded border bg-muted">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="font-mono text-caption text-muted-foreground">no image</span>
        )}
      </div>
      <p className="truncate font-mono text-small font-medium">{product.title}</p>
      <div className="flex items-center gap-2">
        {product.priceCents != null && (
          <span className="font-mono text-small">
            {(product.priceCents / 100).toFixed(2)} {product.currency}
          </span>
        )}
        <span
          className={cn(
            "font-mono text-caption",
            outOfStock ? "text-terminal-red" : "text-terminal-green",
          )}
        >
          {product.availability ? product.availability.replace(/_/g, " ") : ""}
        </span>
      </div>
      {product.externalUrl && (
        <a
          href={product.externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 font-mono text-caption text-terminal-blue hover:underline"
        >
          <ExternalLink className="size-3" />
          {product.provider ? `Buy on ${product.provider}` : "Buy"}
        </a>
      )}
    </div>
  );
}
