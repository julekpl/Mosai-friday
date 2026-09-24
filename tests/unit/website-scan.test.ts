import { describe, expect, it } from "vitest";
import {
  extractSitemapLocations,
  extractWebsitePage,
  isAllowedByRobots,
  normalizeCrawlUrl,
  parseRobotsTxt,
  prioritizeSiteUrls,
} from "@/convex/lib/websiteScan";

describe("website scan extraction", () => {
  it("discovers sitemap locations from both sitemap indexes and URL sets", () => {
    const xml = `<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/sitemaps/products.xml</loc></sitemap><sitemap><loc>https://example.com/sitemaps/pages.xml</loc></sitemap></sitemapindex>`;
    expect(extractSitemapLocations(xml)).toEqual([
      "https://example.com/sitemaps/products.xml",
      "https://example.com/sitemaps/pages.xml",
    ]);
  });

  it("honors robots allow/disallow precedence and reads sitemap hints", () => {
    const rules = parseRobotsTxt(`User-agent: *\nDisallow: /private\nAllow: /private/public\nSitemap: https://example.com/sitemap-index.xml`);
    expect(isAllowedByRobots("/private/report", rules)).toBe(false);
    expect(isAllowedByRobots("/private/public/item", rules)).toBe(true);
    expect(isAllowedByRobots("/about", rules)).toBe(true);
    expect(rules.sitemapUrls).toEqual(["https://example.com/sitemap-index.xml"]);
  });

  it("keeps crawl URLs on the supplied site and removes tracking fragments", () => {
    expect(normalizeCrawlUrl("/services?utm_campaign=spring#main", "https://www.example.com/"))
      .toBe("https://www.example.com/services");
    expect(normalizeCrawlUrl("https://other.example/about", "https://www.example.com/"))
      .toBeNull();
    expect(normalizeCrawlUrl("http://www.example.com/about", "https://www.example.com/"))
      .toBeNull();
    expect(normalizeCrawlUrl("https://user:pass@www.example.com/", "https://www.example.com/"))
      .toBeNull();
  });

  it("extracts offerings, contact, location, social links and footer evidence", () => {
    const page = extractWebsitePage(`
      <html><head><title>Northwind Cloud</title><meta name="description" content="Managed cloud hosting">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Northwind Cloud","email":"hello@example.com","telephone":"+31 20 555 0100","address":{"@type":"PostalAddress","streetAddress":"Main Street 1","addressLocality":"Amsterdam","postalCode":"1011 AB","addressCountry":"NL"},"hasOfferCatalog":{"@type":"OfferCatalog","itemListElement":[{"@type":"Service","name":"Managed hosting"}]}}</script></head>
      <body><header><a href="/services">Services</a><a href="https://www.linkedin.com/company/northwind-cloud">LinkedIn</a></header>
      <main><h1>Cloud services for growing teams</h1><p>Reliable infrastructure with local support.</p></main>
      <footer><address>Main Street 1, Amsterdam, Netherlands</address><a href="mailto:hello@example.com">Email us</a></footer></body></html>`, "https://example.com/");

    expect(page.title).toBe("Northwind Cloud");
    expect(page.productsServices).toContain("Managed hosting");
    expect(page.socialChannels).toEqual(["https://www.linkedin.com/company/northwind-cloud"]);
    expect(page.businessDetails.name).toBe("Northwind Cloud");
    expect(page.businessDetails.address).toContain("Amsterdam");
    expect(page.businessDetails.country).toBe("Netherlands");
    expect(page.businessDetails.email).toBe("hello@example.com");
    expect(page.businessDetails.footerExcerpt).toContain("Netherlands");
    expect(page.internalLinks.some((link) => link.url === "https://example.com/services"))
      .toBe(true);
  });

  it("selects homepage and business-relevant pages before low-value articles", () => {
    expect(prioritizeSiteUrls([
      "https://example.com/blog/update",
      "https://example.com/about",
      "https://example.com/products/platform",
      "https://example.com/",
    ], 3)).toEqual([
      "https://example.com/",
      "https://example.com/products/platform",
      "https://example.com/about",
    ]);
  });
});
