import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import {
  ArrowRight,
  ChevronLeft,
  ExternalLink,
  Home,
  PackageOpen,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageRenderer } from "@/components/cms/PageRenderer";

/* ── MOSAI storefront — connector-driven, multi-page (svelte-commerce pattern)
 *
 * Path suffixes after /shop/:projectId:
 *   /            shop home: homepage blocks + collections + product browser
 *   /c/:slug     collection page (search/filter/sort over canonical products)
 *   /p/:slug     product detail — variants, gallery, provider checkout handoff
 *   /*           published CMS page (immutable revision)
 *
 * Price/availability/images resolve live from Sell at render time (§50) —
 * the storefront never stores copies. External products hand off to the
 * provider via externalUrl (§57) until the native engine (W7) exists.
 */

type SortKey = "featured" | "price_asc" | "price_desc" | "title";

type CollectionDoc = Doc<"collections">;

export default function StorefrontApp() {
  const { projectId } = useParams<{ projectId: Id<"projects"> }>();
  const location = useLocation();
  const navigate = useNavigate();

  const prefix = `/shop/${projectId}`;
  const suffix = location.pathname.startsWith(prefix)
    ? location.pathname.slice(prefix.length) || "/"
    : "/";

  const site = useQuery(api.storefront.getShopSite, { projectId: projectId! });
  const collections = useQuery(api.storefront.listShopCollections, {
    projectId: projectId!,
  });

  const pageResult = useQuery(
    api.storefront.getPublishedPage,
    isContentPath(suffix) ? { projectId: projectId!, path: suffix } : "skip",
  );

  // Honor the site redirect table (§33) — auto-301s from published path changes.
  useEffect(() => {
    if (
      pageResult &&
      typeof pageResult === "object" &&
      "kind" in pageResult &&
      pageResult.kind === "redirect"
    ) {
      navigate(`${prefix}${pageResult.to}`, { replace: true });
    }
  }, [pageResult, navigate, prefix]);

  const shopCollections = useMemo(
    () => (collections ?? []).filter((c) => c.slug),
    [collections],
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            to={prefix}
            className="flex items-center gap-2 font-mono text-small font-semibold tracking-tight"
          >
            <span className="grid size-7 place-items-center rounded-md bg-terminal-green-soft font-mono text-caption text-terminal-green">
              {site?.name?.slice(0, 1).toUpperCase() ?? "M"}
            </span>
            {site?.name ?? "Store"}
          </Link>
          <nav className="ml-auto flex flex-wrap items-center gap-1 font-mono text-caption">
            <StoreNavLink to={prefix} label="Shop" active={suffix === "/"} />
            {shopCollections.map((c) => (
              <StoreNavLink
                key={c._id}
                to={`${prefix}/c/${c.slug}`}
                label={c.title}
                active={suffix === `/c/${c.slug}`}
              />
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {suffix === "/" ? (
          <ShopHome
            projectId={projectId!}
            homepageDoc={
              pageResult &&
              typeof pageResult === "object" &&
              "kind" in pageResult &&
              pageResult.kind === "page"
                ? pageResult.document
                : null
            }
          />
        ) : suffix.startsWith("/c/") ? (
          <CollectionPage
            projectId={projectId!}
            slug={suffix.slice(3)}
            collections={shopCollections}
          />
        ) : suffix.startsWith("/p/") ? (
          <ProductPage projectId={projectId!} slug={suffix.slice(3)} />
        ) : (
          <CmsPageView result={pageResult} />
        )}
      </main>

      <footer className="border-t py-6">
        <p className="text-center font-mono text-caption text-muted-foreground">
          {site?.name ?? "MOSAI"} · powered by MOSAI storefront
        </p>
      </footer>
    </div>
  );
}

function isContentPath(suffix: string): boolean {
  return suffix !== "/" && !suffix.startsWith("/c/") && !suffix.startsWith("/p/");
}

function StoreNavLink({
  to,
  label,
  active,
}: {
  to: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "rounded-sm px-2.5 py-1.5 transition-colors ease-terminal hover:bg-accent",
        active && "bg-accent font-medium text-terminal-green",
      )}
    >
      {label}
    </Link>
  );
}

/* ── Shop home ─────────────────────────────────────────────────────────── */

function ShopHome({
  projectId,
  homepageDoc,
}: {
  projectId: Id<"projects">;
  homepageDoc: unknown;
}) {
  return (
    <div className="grid gap-10">
      {homepageDoc ? (
        <PageRenderer doc={homepageDoc as never} />
      ) : (
        <section className="grid gap-2 py-4 text-center">
          <p className="font-mono text-caption uppercase tracking-widest text-terminal-green">
            storefront
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Everything we make, in one place
          </h1>
        </section>
      )}
      <ProductBrowser projectId={projectId} showHeading />
    </div>
  );
}

/* ── Product browser: search + availability + sort (§55, §56) ──────────── */

function ProductBrowser({
  projectId,
  collectionId,
  showHeading,
}: {
  projectId: Id<"projects">;
  collectionId?: Id<"collections">;
  showHeading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<"all" | "in_stock">("all");
  const [sort, setSort] = useState<SortKey>("featured");

  const products = useQuery(api.storefront.listShopProducts, {
    projectId,
    collectionId,
    search: search || undefined,
    availability,
    sort,
  });

  return (
    <section className="grid gap-4">
      {showHeading && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">All products</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="h-9 w-48 rounded-md border bg-card pl-8 pr-3 font-mono text-caption outline-none focus:ring-2 focus:ring-terminal-green/40"
              />
            </label>
            <select
              value={availability}
              onChange={(e) => setAvailability(e.target.value as "all" | "in_stock")}
              className="h-9 cursor-pointer rounded-md border bg-card px-2 font-mono text-caption"
            >
              <option value="all">all items</option>
              <option value="in_stock">in stock only</option>
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-9 cursor-pointer rounded-md border bg-card px-2 font-mono text-caption"
            >
              <option value="featured">featured</option>
              <option value="price_asc">price ↑</option>
              <option value="price_desc">price ↓</option>
              <option value="title">A–Z</option>
            </select>
          </div>
        </div>
      )}

      <ProductGrid products={products} />
    </section>
  );
}

type StorefrontProduct = {
  productId: string;
  title: string;
  slug: string | null;
  priceCents: number | null;
  compareAtPriceCents?: number | null;
  currency: string;
  availability: string | null;
  imageUrl: string | null;
  externalUrl?: string | null;
  provider: string | null;
};

function ProductGrid({
  products,
  detailPrefix,
}: {
  products: StorefrontProduct[] | undefined;
  detailPrefix?: string;
}) {
  if (products === undefined) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-56 animate-pulse rounded-md border bg-muted" />
        ))}
      </div>
    );
  }
  if (products.length === 0) {
    return (
      <div className="grid place-items-center gap-2 rounded-md border border-dashed p-10 text-center">
        <PackageOpen className="size-6 text-muted-foreground" />
        <p className="font-mono text-small font-medium">No products found</p>
        <p className="font-mono text-caption text-muted-foreground">
          Try a different search, or check back soon.
        </p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.productId} product={p} detailPrefix={detailPrefix} />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  detailPrefix = "",
}: {
  product: StorefrontProduct;
  detailPrefix?: string;
}) {
  const outOfStock = product.availability === "out_of_stock";
  const detailHref = product.slug ? `${detailPrefix}/p/${product.slug}` : null;
  return (
    <div className="group grid gap-2 rounded-md border bg-card p-3 shadow-card transition-colors ease-terminal hover:bg-accent/40">
      <Link
        to={detailHref ?? "#"}
        className={cn(
          "grid aspect-square place-items-center overflow-hidden rounded border bg-muted",
          !detailHref && "pointer-events-none",
        )}
      >
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 ease-mosaic group-hover:scale-[1.03]"
          />
        ) : (
          <PackageOpen className="size-8 text-muted-foreground/50" />
        )}
      </Link>
      <div className="min-w-0">
        {detailHref ? (
          <Link
            to={detailHref}
            className="block truncate font-mono text-small font-medium hover:text-terminal-green"
          >
            {product.title}
          </Link>
        ) : (
          <p className="truncate font-mono text-small font-medium">{product.title}</p>
        )}
        <div className="mt-0.5 flex items-center gap-2">
          <PriceTag
            cents={product.priceCents}
            compareAt={product.compareAtPriceCents}
            currency={product.currency}
          />
          {product.availability && (
            <span
              className={cn(
                "font-mono text-caption",
                outOfStock ? "text-terminal-red" : "text-terminal-green",
              )}
            >
              {outOfStock ? "sold out" : "in stock"}
            </span>
          )}
        </div>
      </div>
      {product.externalUrl ? (
        <a
          href={product.externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex w-fit items-center gap-1 rounded-md bg-primary px-3 py-1.5 font-mono text-caption font-medium text-primary-foreground transition-transform duration-200 ease-mosaic hover:-translate-y-0.5"
        >
          Buy {product.provider ? `on ${product.provider}` : "now"}
          <ExternalLink className="size-3" />
        </a>
      ) : detailHref ? (
        <Link
          to={detailHref}
          className="inline-flex w-fit items-center gap-1 rounded-md border px-3 py-1.5 font-mono text-caption font-medium transition-colors ease-terminal hover:bg-accent"
        >
          View <ArrowRight className="size-3" />
        </Link>
      ) : null}
    </div>
  );
}

function PriceTag({
  cents,
  compareAt,
  currency,
}: {
  cents: number | null;
  compareAt?: number | null;
  currency: string;
}) {
  if (cents == null) return null;
  const money = (c: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(c / 100);
  return (
    <span className="flex items-baseline gap-1.5 font-mono text-small">
      {money(cents)}
      {compareAt != null && compareAt > cents && (
        <span className="font-mono text-caption text-muted-foreground line-through">
          {money(compareAt)}
        </span>
      )}
    </span>
  );
}

/* ── Collection page ───────────────────────────────────────────────────── */

function CollectionPage({
  projectId,
  slug,
  collections,
}: {
  projectId: Id<"projects">;
  slug: string;
  collections: CollectionDoc[];
}) {
  const collection = useQuery(api.storefront.getShopCollection, { projectId, slug });

  if (collection === undefined) {
    return <div className="h-64 animate-pulse rounded-md border bg-muted" />;
  }
  if (collection === null) {
    return <NotFoundView message="Collection not found" />;
  }

  return (
    <div className="grid gap-6">
      <Breadcrumbs
        items={[{ label: "Shop", to: `/shop/${projectId}` }, { label: collection.title }]}
      />
      <section className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{collection.title}</h1>
        {collection.description && (
          <p className="max-w-2xl font-mono text-caption text-muted-foreground">
            {collection.description}
          </p>
        )}
        {collection.provider && (
          <p className="mt-1 inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-caption text-terminal-blue">
            synced from {collection.provider}
          </p>
        )}
      </section>
      <ProductBrowser projectId={projectId} collectionId={collection._id} showHeading={false} />
      {collections.length > 1 && (
        <section className="grid gap-2 border-t pt-6">
          <p className="font-mono text-caption text-muted-foreground">other collections</p>
          <div className="flex flex-wrap gap-2">
            {collections
              .filter((c) => c.slug !== slug)
              .map((c) => (
                <Link
                  key={c._id}
                  to={`/shop/${projectId}/c/${c.slug}`}
                  className="rounded-md border px-3 py-1.5 font-mono text-caption transition-colors ease-terminal hover:bg-accent"
                >
                  {c.title}
                </Link>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Product detail: variants, gallery, handoff (§57, §91) ─────────────── */

type ShopProductData = {
  product: {
    productId: string;
    title: string;
    slug: string | null;
    description: string | null;
    externalUrl: string | null;
    provider: string | null;
    productType: string | null;
    tags: string[];
  };
  variants: {
    variantId: string;
    title: string;
    isDefault: boolean;
    priceCents: number | null;
    compareAtPriceCents: number | null;
    currency: string;
    inventoryCount: number | null;
    availability: string | null;
    optionValues: { name: string; value: string }[];
  }[];
  media: { mediaId: string; url: string; alt: string | null }[];
  related: {
    productId: string;
    slug: string | null;
    title: string;
    priceCents: number | null;
    currency: string;
    availability: string | null;
    imageUrl: string | null;
    provider: string | null;
  }[];
};

function ProductPage({ projectId, slug }: { projectId: Id<"projects">; slug: string }) {
  const data = useQuery(api.storefront.getShopProduct, { projectId, slug }) as
    | ShopProductData
    | null
    | undefined;

  const defaultVariant = data?.variants.find((v) => v.isDefault) ?? data?.variants[0];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeMedia, setActiveMedia] = useState(0);

  useEffect(() => {
    if (data && selectedId === null) {
      setSelectedId(defaultVariant?.variantId ?? null);
    }
  }, [data, selectedId, defaultVariant?.variantId]);

  if (data === undefined) {
    return <div className="h-96 animate-pulse rounded-md border bg-muted" />;
  }
  if (data === null) {
    return <NotFoundView message="Product not found" />;
  }

  const selected = data.variants.find((v) => v.variantId === selectedId) ?? defaultVariant;
  const outOfStock = selected?.availability === "out_of_stock";

  return (
    <div className="grid gap-10">
      <Breadcrumbs
        items={[
          { label: "Shop", to: `/shop/${projectId}` },
          { label: data.product.title },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Gallery */}
        <div className="grid gap-2">
          <div className="grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted">
            {data.media[activeMedia]?.url ? (
              <img
                src={data.media[activeMedia].url}
                alt={data.media[activeMedia].alt ?? data.product.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <PackageOpen className="size-10 text-muted-foreground/50" />
            )}
          </div>
          {data.media.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {data.media.map((m, i) => (
                <button
                  key={m.mediaId}
                  type="button"
                  onClick={() => setActiveMedia(i)}
                  className={cn(
                    "size-14 overflow-hidden rounded border transition-colors ease-terminal",
                    i === activeMedia
                      ? "border-terminal-green"
                      : "cursor-pointer hover:border-terminal-green/40",
                  )}
                >
                  <img src={m.url} alt={m.alt ?? ""} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buy panel */}
        <div className="grid content-start gap-4">
          <div className="grid gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{data.product.title}</h1>
            {data.product.productType && (
              <p className="font-mono text-caption text-muted-foreground">
                {data.product.productType}
              </p>
            )}
          </div>

          <PriceTag
            cents={selected?.priceCents ?? null}
            compareAt={selected?.compareAtPriceCents}
            currency={selected?.currency ?? "USD"}
          />

          {selected?.availability && (
            <p
              className={cn(
                "font-mono text-caption",
                outOfStock ? "text-terminal-red" : "text-terminal-green",
              )}
            >
              {outOfStock
                ? "sold out"
                : `in stock${selected.inventoryCount != null ? ` · ${selected.inventoryCount} available` : ""}`}
            </p>
          )}

          {/* Variant selector — option values come from canonical Variants */}
          {data.variants.length > 1 && (
            <div className="grid gap-1.5">
              <p className="font-mono text-caption text-muted-foreground">
                {data.variants[0]?.optionValues?.[0]?.name ?? "variant"}
              </p>
              <div className="flex flex-wrap gap-2">
                {data.variants.map((v) => {
                  const active = v.variantId === selected?.variantId;
                  const vOut = v.availability === "out_of_stock";
                  return (
                    <button
                      key={v.variantId}
                      type="button"
                      disabled={vOut}
                      onClick={() => setSelectedId(v.variantId)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 font-mono text-caption transition-colors ease-terminal",
                        active && "border-terminal-green bg-terminal-green-soft text-terminal-green",
                        !active && "cursor-pointer hover:bg-accent",
                        vOut && "cursor-not-allowed text-muted-foreground line-through",
                      )}
                    >
                      {v.optionValues?.length
                        ? v.optionValues.map((o) => o.value).join(" / ")
                        : v.title}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Checkout handoff — provider-authoritative (§57) */}
          {data.product.externalUrl ? (
            <a
              href={data.product.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className={cn(
                "inline-flex w-fit items-center gap-2 rounded-md bg-primary px-5 py-2.5 font-mono text-small font-medium text-primary-foreground transition-transform duration-200 ease-mosaic hover:-translate-y-0.5",
                outOfStock && "pointer-events-none opacity-50",
              )}
            >
              Buy {data.product.provider ? `on ${data.product.provider}` : "now"}
              <ExternalLink className="size-3.5" />
            </a>
          ) : (
            <p className="rounded-md border border-terminal-amber/40 bg-terminal-amber-soft px-3 py-2 font-mono text-caption text-terminal-amber">
              Checkout arrives with the native commerce engine (W7) — this product
              is currently display-only.
            </p>
          )}

          {data.product.description && (
            <p className="whitespace-pre-line font-mono text-small leading-relaxed text-muted-foreground">
              {data.product.description}
            </p>
          )}
          {data.product.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.product.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full border px-2 py-0.5 font-mono text-caption text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {data.related.length > 0 && (
        <section className="grid gap-3 border-t pt-8">
          <h2 className="text-lg font-semibold tracking-tight">You may also like</h2>
          <ProductGrid products={data.related} />
        </section>
      )}
    </div>
  );
}

/* ── Published CMS page ────────────────────────────────────────────────── */

type PageResult =
  | { kind: "page"; page: { title: string; fullPath: string }; document: unknown }
  | { kind: "not_found" }
  | { kind: "redirect"; to: string }
  | undefined;

function CmsPageView({ result }: { result: PageResult | null }) {
  if (result === undefined) {
    return <div className="h-64 animate-pulse rounded-md border bg-muted" />;
  }
  if (!result || result.kind !== "page") {
    return <NotFoundView message="Page not found" />;
  }
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">{result.page.title}</h1>
      <PageRenderer doc={result.document as never} />
    </article>
  );
}

/* ── Shared bits ───────────────────────────────────────────────────────── */

function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 font-mono text-caption text-muted-foreground">
      <Home className="size-3" />
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span>/</span>}
          {it.to ? (
            <Link to={it.to} className="hover:text-terminal-green">
              {it.label}
            </Link>
          ) : (
            <span className="text-foreground">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function NotFoundView({ message }: { message: string }) {
  return (
    <div className="grid place-items-center gap-3 rounded-md border border-dashed p-16 text-center">
      <ChevronLeft className="size-5 text-muted-foreground" />
      <p className="font-mono text-h3">{message}</p>
      <p className="font-mono text-caption text-muted-foreground">
        The page you're looking for doesn't exist or isn't published.
      </p>
    </div>
  );
}
