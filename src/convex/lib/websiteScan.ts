import * as cheerio from "cheerio";

export type WebsitePageFinding = {
  url: string;
  title?: string;
  description?: string;
  headings: string[];
  productsServices: string[];
  excerpt: string;
};

export type WebsiteBusinessDetails = {
  name?: string;
  address?: string;
  country?: string;
  phone?: string;
  email?: string;
  footerExcerpt?: string;
};

/** A public picture address found on the owner's page (U5). Data only:
 *  nothing is fetched at scan time; an import later goes through
 *  `safeFetchBytes`. */
export type WebsiteImage = { url: string; alt?: string; pageUrl?: string };

export type WebsitePageExtraction = WebsitePageFinding & {
  internalLinks: Array<{ url: string; label: string }>;
  images: WebsiteImage[];
  socialChannels: string[];
  businessDetails: WebsiteBusinessDetails;
};

export type RobotsRules = {
  sitemapUrls: string[];
  allow: string[];
  disallow: string[];
};

const PRODUCT_SERVICE_WORDS =
  /\b(shop|store|product|products|service|services|plans|pricing|solutions|packages|menu|offers|subscriptions?|courses?|consulting|software|platform)\b/i;
const SOCIAL_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "x.com",
  "twitter.com",
  "pinterest.com",
  "threads.net",
] as const;

let cachedCountryNames: string[] | undefined;

function countryNames(): string[] {
  if (cachedCountryNames) return cachedCountryNames;
  const names = new Set<string>();
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const name = display.of(code);
      if (name && name.toUpperCase() !== code && name.length > 3) names.add(name);
    }
  }
  cachedCountryNames = [...names].sort((left, right) => right.length - left.length);
  return cachedCountryNames;
}

function countryFromText(text: string): string | undefined {
  const fold = (value: string) => value.toLocaleLowerCase("en").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const folded = ` ${fold(text)} `;
  for (const name of countryNames()) {
    if (folded.includes(` ${fold(name)} `)) return name;
  }
  const aliases: Array<[RegExp, string]> = [
    [/\bdeutschland\b/i, "Germany"],
    [/\bnederland\b/i, "Netherlands"],
    [/\bpolska\b/i, "Poland"],
    [/\b[öo]sterreich\b/i, "Austria"],
    [/\bespa[nñ]a\b/i, "Spain"],
    [/\bitalia\b/i, "Italy"],
    [/\bsverige\b/i, "Sweden"],
    [/\bsuomi\b/i, "Finland"],
    [/\bbelgië\b|\bbelgique\b/i, "Belgium"],
    [/\bdanmark\b/i, "Denmark"],
  ];
  return aliases.find(([pattern]) => pattern.test(text))?.[1];
}

function normalizeCountry(value: string): string {
  const normalized = cleanText(value, 80);
  if (!/^[A-Z]{2}$/i.test(normalized)) return normalized;
  const name = new Intl.DisplayNames(["en"], { type: "region" }).of(normalized.toUpperCase());
  return name && name.toUpperCase() !== normalized.toUpperCase() ? name : normalized;
}

function cleanText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sameSiteHost(hostname: string, baseHostname: string): boolean {
  const withoutWww = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return withoutWww(hostname) === withoutWww(baseHostname);
}

export function normalizeCrawlUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = new URL(raw, baseUrl);
    const base = new URL(baseUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!sameSiteHost(url.hostname, base.hostname)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function parseRobotsTxt(text: string): RobotsRules {
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[] }> = [];
  let agents: string[] = [];
  let allow: string[] = [];
  let disallow: string[] = [];
  let hasRules = false;
  const flush = () => {
    if (agents.length) groups.push({ agents, allow, disallow });
    agents = [];
    allow = [];
    disallow = [];
    hasRules = false;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#", 1)[0].trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (hasRules) flush();
      agents.push(value.toLowerCase());
    } else if (key === "allow" || key === "disallow") {
      hasRules = true;
      if (!value) continue;
      (key === "allow" ? allow : disallow).push(value);
    } else if (key === "sitemap" && value) {
      // Kept separately below; sitemap is not tied to a user-agent group.
    }
  }
  flush();

  const sitemapUrls = [...text.matchAll(/^\s*Sitemap\s*:\s*(\S+)/gim)]
    .map((match) => match[1].trim())
    .slice(0, 20);
  const matching = groups.filter((group) =>
    group.agents.some((agent) => agent === "*" || agent === "mosaibot"),
  );
  return {
    sitemapUrls,
    allow: matching.flatMap((group) => group.allow),
    disallow: matching.flatMap((group) => group.disallow),
  };
}

function robotRuleMatches(rule: string, pathname: string): boolean {
  const escaped = rule
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$/g, "$");
  try {
    return new RegExp(`^${escaped}`).test(pathname);
  } catch {
    return false;
  }
}

export function isAllowedByRobots(pathname: string, rules: RobotsRules): boolean {
  const matching = [
    ...rules.allow.filter((rule) => robotRuleMatches(rule, pathname)),
    ...rules.disallow.filter((rule) => robotRuleMatches(rule, pathname)),
  ];
  if (!matching.length) return true;
  matching.sort((left, right) => right.length - left.length);
  const longest = matching[0].length;
  const winners = matching.filter((rule) => rule.length === longest);
  return winners.some((rule) => rules.allow.includes(rule));
}

export function extractSitemapLocations(xml: string): string[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  const locations: string[] = [];
  $("loc").each((_, element) => {
    const location = cleanText($(element).text(), 2_000);
    if (location.startsWith("https://") && !locations.includes(location)) {
      locations.push(location);
    }
  });
  return locations;
}

function collectJsonLd(value: unknown, facts: {
  productsServices: string[];
  businessDetails: WebsiteBusinessDetails;
}): void {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLd(item, facts));
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  const rawType = node["@type"];
  const types = (Array.isArray(rawType) ? rawType : [rawType])
    .filter((type): type is string => typeof type === "string");
  const name = typeof node.name === "string" ? cleanText(node.name, 120) : "";
  if (name && types.some((type) => /Product|Service|Offer|ProductCollection/i.test(type))) {
    facts.productsServices.push(name);
  }
  if (name && types.some((type) => /Organization|LocalBusiness|Corporation/i.test(type))) {
    facts.businessDetails.name ??= name;
    if (typeof node.telephone === "string") facts.businessDetails.phone ??= cleanText(node.telephone, 80);
    if (typeof node.email === "string") facts.businessDetails.email ??= cleanText(node.email, 120);
    const address = node.address;
    if (address && typeof address === "object") {
      const fields = address as Record<string, unknown>;
      const addressParts = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]
        .map((field) => fields[field])
        .filter((part): part is string => typeof part === "string" && Boolean(part.trim()));
      if (addressParts.length) facts.businessDetails.address ??= cleanText(addressParts.join(", "), 300);
      const country = fields.addressCountry;
      if (typeof country === "string") facts.businessDetails.country ??= normalizeCountry(country);
      if (country && typeof country === "object" && "name" in country && typeof country.name === "string") {
        facts.businessDetails.country ??= normalizeCountry(country.name);
      }
    }
  }
  Object.values(node).forEach((child) => collectJsonLd(child, facts));
}

export const MAX_SCAN_IMAGES = 12;

/** Absolute https address of a picture, or null for data:, http:, .svg,
 *  credentialed or unparsable addresses. */
export function normalizeImageUrl(raw: string, pageUrl: string): string | null {
  const value = raw.trim();
  if (!value || /^data:/i.test(value)) return null;
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (/\.svgz?$/i.test(url.pathname)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** The best candidate of a `srcset`: the largest width (`w`) or density
 *  (`x`) descriptor; the first entry when none is given. */
export function bestSrcsetCandidate(srcset: string): string | null {
  let best: { url: string; score: number } | null = null;
  for (const part of srcset.split(",")) {
    const [candidate, descriptor = ""] = part.trim().split(/\s+/, 2);
    if (!candidate) continue;
    const match = descriptor.match(/^(\d+(?:\.\d+)?)([wx])$/i);
    const score = match ? Number(match[1]) * (match[2].toLowerCase() === "x" ? 1_000 : 1) : 0;
    if (!best || score > best.score) best = { url: candidate, score };
  }
  return best?.url ?? null;
}

function isTrackingPixel(width: string | undefined, height: string | undefined): boolean {
  const tiny = (value: string | undefined) => {
    if (value === undefined) return false;
    const n = Number.parseFloat(value);
    return Number.isFinite(n) && n <= 2;
  };
  return tiny(width) || tiny(height);
}

/** og:image first, then `<img>` (srcset best candidate, else src), unique,
 *  at most `MAX_SCAN_IMAGES`. */
export function extractPageImages($: cheerio.CheerioAPI, pageUrl: string): WebsiteImage[] {
  const images: WebsiteImage[] = [];
  const add = (raw: string | undefined, alt?: string) => {
    if (!raw || images.length >= MAX_SCAN_IMAGES) return;
    const url = normalizeImageUrl(raw, pageUrl);
    if (!url || images.some((image) => image.url === url)) return;
    const cleanAlt = alt ? cleanText(alt, 200) : "";
    images.push({ url, ...(cleanAlt ? { alt: cleanAlt } : {}), pageUrl });
  };
  const ogAlt = $('meta[property="og:image:alt"]').first().attr("content");
  $('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="og:image"]').each((_, element) => {
    add($(element).attr("content"), ogAlt);
  });
  $("img").each((_, element) => {
    const img = $(element);
    if (isTrackingPixel(img.attr("width"), img.attr("height"))) return;
    const srcset = img.attr("srcset") ?? img.attr("data-srcset");
    const fromSet = srcset ? bestSrcsetCandidate(srcset) : null;
    add(fromSet ?? img.attr("src") ?? img.attr("data-src"), img.attr("alt"));
  });
  return images;
}

/** Merge per-page image lists, unique by address, capped. */
export function mergeScanImages(lists: WebsiteImage[][]): WebsiteImage[] {
  const out: WebsiteImage[] = [];
  for (const list of lists) {
    for (const image of list) {
      if (out.length >= MAX_SCAN_IMAGES) return out;
      if (!out.some((existing) => existing.url === image.url)) out.push(image);
    }
  }
  return out;
}

export function extractWebsitePage(html: string, url: string): WebsitePageExtraction {
  const $ = cheerio.load(html);
  const images = extractPageImages($, url);
  const title = cleanText($("head title").first().text(), 180) || undefined;
  const description = cleanText(
    $('meta[name="description"], meta[property="og:description"]').first().attr("content") ?? "",
    400,
  ) || undefined;
  const headings: string[] = [];
  $("h1, h2, h3").each((_, element) => {
    const heading = cleanText($(element).text(), 120);
    if (heading && !headings.includes(heading)) headings.push(heading);
  });

  const facts = { productsServices: [] as string[], businessDetails: {} as WebsiteBusinessDetails };
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      collectJsonLd(JSON.parse($(element).text()) as unknown, facts);
    } catch {
      // Skip malformed structured data and continue collecting visible page details.
    }
  });

  const productLinks: string[] = [];
  $("nav a, header a, footer a, main a, a[href]").each((_, element) => {
    const label = cleanText($(element).text(), 100);
    if (label && PRODUCT_SERVICE_WORDS.test(label)) productLinks.push(label);
  });
  const productsServices = [...new Set([...facts.productsServices, ...productLinks])].slice(0, 40);

  const internalLinks: Array<{ url: string; label: string }> = [];
  $("a[href]").each((_, element) => {
    const normalized = normalizeCrawlUrl($(element).attr("href") ?? "", url);
    if (!normalized || internalLinks.some((link) => link.url === normalized)) return;
    internalLinks.push({ url: normalized, label: cleanText($(element).text(), 100) });
  });

  const socialChannels = [...new Set($("a[href]").toArray().flatMap((element) => {
    try {
      const social = new URL($(element).attr("href") ?? "", url);
      if (social.protocol !== "https:" || social.username || social.password) return [];
      const host = social.hostname.replace(/^www\./, "");
      return SOCIAL_HOSTS.some((socialHost) => host === socialHost || host.endsWith(`.${socialHost}`))
        ? [social.toString()]
        : [];
    } catch {
      return [];
    }
  }))].slice(0, 20);

  const footerExcerpt = cleanText($("footer").text(), 1_000) || undefined;
  facts.businessDetails.footerExcerpt = footerExcerpt;
  const addressElement = $("address").first().text();
  facts.businessDetails.address ??= cleanText(addressElement, 300) || undefined;
  for (const link of $("a[href^='tel:']").toArray()) {
    facts.businessDetails.phone ??= cleanText($(link).attr("href")?.slice(4) ?? "", 80) || undefined;
  }
  for (const link of $("a[href^='mailto:']").toArray()) {
    facts.businessDetails.email ??= cleanText($(link).attr("href")?.slice(7).split("?")[0] ?? "", 120) || undefined;
  }
  const region = $("meta[name='geo.region']").attr("content")?.split("-")[0];
  if (region) facts.businessDetails.country ??= normalizeCountry(region);
  facts.businessDetails.country ??= countryFromText(`${addressElement} ${footerExcerpt ?? ""}`);

  $("script, style, noscript, svg, nav, footer, header").remove();
  const mainText = $("main").text() || $("body").text();
  return {
    url,
    title,
    description,
    headings: headings.slice(0, 24),
    productsServices,
    excerpt: cleanText(mainText, 1_800),
    internalLinks: internalLinks.slice(0, 150),
    images,
    socialChannels,
    businessDetails: facts.businessDetails,
  };
}

export function prioritizeSiteUrls(
  urls: string[],
  limit: number,
): string[] {
  const score = (url: string) => {
    const path = new URL(url).pathname.toLowerCase();
    if (path === "/" || path === "") return 100;
    if (/product|service|solution|offering|menu/.test(path)) return 80;
    if (/pricing|plan|package|shop|catalog/.test(path)) return 75;
    if (/about|company|who-we-are/.test(path)) return 65;
    if (/contact|location|store|visit/.test(path)) return 60;
    if (/industry|sector|use-case/.test(path)) return 40;
    if (/blog|news|article|tag|category|author|search|cart|login/.test(path)) return 10;
    return 25;
  };
  return [...new Set(urls)]
    .map((url, index) => ({ url, index, score: score(url) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ url }) => url);
}
