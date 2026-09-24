/**
 * Public-site proxy (owner decision 24 Sep 2026, option B for MVP): the
 * `/s/<slug>-website/*` pages on the app origin must stay script-free, must
 * never receive the caller's cookies or auth headers, and must never fall
 * through to the SPA.
 */
import { describe, expect, it, vi } from "vitest";
import {
  PUBLIC_SITE_CSP,
  isPublicSitePath,
  proxyPublicSite,
  publicSiteResponseHeaders,
  publicSiteUpstreamPath,
  resolveConvexSiteUrl,
  upstreamRequestInit,
} from "../../server/publicSiteProxy";

const BASE = "https://happy-otter-123.convex.site";

describe("publicSiteUpstreamPath", () => {
  it("maps website paths onto the Convex route", () => {
    expect(publicSiteUpstreamPath("/s/acme-website")).toBe("/public-site/acme-website");
    expect(publicSiteUpstreamPath("/s/acme-website/")).toBe("/public-site/acme-website/");
    expect(publicSiteUpstreamPath("/s/acme-co-website/about")).toBe(
      "/public-site/acme-co-website/about",
    );
    expect(publicSiteUpstreamPath("/s/acme-website/blog/first-post")).toBe(
      "/public-site/acme-website/blog/first-post",
    );
  });

  it("rejects traversal, encoding, odd characters and non-website slugs", () => {
    for (const bad of [
      "/s/",
      "/s",
      "/s//acme-website",
      "/s/acme-website//about",
      "/s/acme-website/..",
      "/s/acme-website/../admin",
      "/s/acme-website/a..b",
      "/s/acme-website/.",
      "/s/acme-website/%2e%2e",
      "/s/acme-website/a%2Fb",
      "/s/..-website",
      "/s/Acme-website",
      "/s/acme_website",
      "/s/acme-app",
      "/s/acme",
      "/s/-website",
      "/s/acme-website/<script>",
      "/s/acme-website/a b",
      "/app/acme-website",
      `/s/acme-website/${"a".repeat(1100)}`,
    ]) {
      expect(publicSiteUpstreamPath(bad), bad).toBeNull();
    }
  });

  it("owns every /s path so none can reach index.html", () => {
    expect(isPublicSitePath("/s")).toBe(true);
    expect(isPublicSitePath("/s/")).toBe(true);
    expect(isPublicSitePath("/s/whatever")).toBe(true);
    expect(isPublicSitePath("/shop/abc")).toBe(false);
    expect(isPublicSitePath("/system")).toBe(false);
  });
});

describe("resolveConvexSiteUrl", () => {
  it("prefers CONVEX_SITE_URL", () => {
    expect(
      resolveConvexSiteUrl({
        CONVEX_SITE_URL: "https://custom.example.com/",
        VITE_CONVEX_URL: "https://a.convex.cloud",
      }),
    ).toBe("https://custom.example.com");
  });

  it("derives .convex.site from VITE_CONVEX_URL", () => {
    expect(resolveConvexSiteUrl({ VITE_CONVEX_URL: "https://happy-otter-123.convex.cloud" })).toBe(
      BASE,
    );
  });

  it("returns null when nothing usable is configured", () => {
    expect(resolveConvexSiteUrl({})).toBeNull();
    expect(resolveConvexSiteUrl({ VITE_CONVEX_URL: "https://example.com" })).toBeNull();
    expect(resolveConvexSiteUrl({ CONVEX_SITE_URL: "http://a.convex.site" })).toBeNull();
    expect(resolveConvexSiteUrl({ CONVEX_SITE_URL: "not a url" })).toBeNull();
  });
});

describe("headers", () => {
  it("forwards no browser headers, body or credentials upstream", () => {
    const init = upstreamRequestInit("GET");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("manual");
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(["Accept"]);
  });

  it("replaces the CSP and drops cookies and unknown headers", () => {
    const upstream = new Headers({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      "set-cookie": "session=1",
      "content-security-policy": "default-src *; script-src 'unsafe-inline'",
      "access-control-allow-origin": "*",
      location: "https://evil.example/",
    });
    const out = publicSiteResponseHeaders(upstream);
    expect(out.get("content-security-policy")).toBe(PUBLIC_SITE_CSP);
    expect(out.get("x-content-type-options")).toBe("nosniff");
    expect(out.get("content-type")).toBe("text/html; charset=utf-8");
    expect(out.get("cache-control")).toBe("public, max-age=60");
    expect(out.get("set-cookie")).toBeNull();
    expect(out.get("access-control-allow-origin")).toBeNull();
    expect(out.get("location")).toBeNull();
  });

  it("keeps a redirect only when it stays inside /s/", () => {
    const out = publicSiteResponseHeaders(new Headers({ location: "/s/acme-website/new" }));
    expect(out.get("location")).toBe("/s/acme-website/new");
  });

  it("allows no script at all", () => {
    expect(PUBLIC_SITE_CSP).toContain("default-src 'none'");
    expect(PUBLIC_SITE_CSP).not.toContain("script-src");
    expect(PUBLIC_SITE_CSP).toContain("frame-ancestors 'none'");
    expect(PUBLIC_SITE_CSP).toContain("form-action 'none'");
    expect(PUBLIC_SITE_CSP).toContain("base-uri 'none'");
  });
});

describe("proxyPublicSite", () => {
  const browserRequest = (path: string, method = "GET") =>
    new Request(`https://appmosai.com${path}?utm=1`, {
      method,
      headers: {
        cookie: "__convexAuth=secret",
        authorization: "Bearer secret",
        "x-forwarded-for": "1.2.3.4",
      },
    });

  it("fetches the Convex route without the caller's headers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response("<h1>Hi</h1>", {
          status: 200,
          headers: { "content-type": "text/html", "set-cookie": "x=1" },
        }),
    );
    const res = await proxyPublicSite(browserRequest("/s/acme-website/about"), {
      siteBaseUrl: BASE,
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/public-site/acme-website/about`);
    const sent = new Headers(init?.headers);
    expect(sent.get("cookie")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
    expect(sent.get("x-forwarded-for")).toBeNull();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Hi</h1>");
    expect(res.headers.get("content-security-policy")).toBe(PUBLIC_SITE_CSP);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("passes the upstream 404 through with the strict CSP", async () => {
    const res = await proxyPublicSite(browserRequest("/s/missing-website"), {
      siteBaseUrl: BASE,
      fetchImpl: async () =>
        new Response("not found", { status: 404, headers: { "content-type": "text/html" } }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-security-policy")).toBe(PUBLIC_SITE_CSP);
  });

  it("returns no body for HEAD", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const res = await proxyPublicSite(browserRequest("/s/acme-website", "HEAD"), {
      siteBaseUrl: BASE,
      fetchImpl,
    });
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("HEAD");
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("refuses other methods without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const res = await proxyPublicSite(
      new Request("https://appmosai.com/s/acme-website", { method: "POST", body: "x" }),
      { siteBaseUrl: BASE, fetchImpl },
    );
    expect(res.status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.headers.get("content-security-policy")).toBe(PUBLIC_SITE_CSP);
  });

  it("404s invalid paths without calling upstream", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const res = await proxyPublicSite(browserRequest("/s/acme-website/%2e%2e/x"), {
      siteBaseUrl: BASE,
      fetchImpl,
    });
    expect(res.status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
    const body = await res.text();
    expect(body).not.toContain("<script");
    expect(body).not.toContain('id="root"');
  });

  it("503s when no Convex site URL is configured", async () => {
    const res = await proxyPublicSite(browserRequest("/s/acme-website"), { siteBaseUrl: null });
    expect(res.status).toBe(503);
    expect(res.headers.get("content-security-policy")).toBe(PUBLIC_SITE_CSP);
  });

  it("502s when the upstream fails or errors", async () => {
    const thrown = await proxyPublicSite(browserRequest("/s/acme-website"), {
      siteBaseUrl: BASE,
      fetchImpl: async () => {
        throw new Error("timeout");
      },
    });
    expect(thrown.status).toBe(502);
    const errored = await proxyPublicSite(browserRequest("/s/acme-website"), {
      siteBaseUrl: BASE,
      fetchImpl: async () => new Response("boom: internal detail", { status: 500 }),
    });
    expect(errored.status).toBe(502);
    expect(await errored.text()).not.toContain("internal detail");
  });

  it("aborts a slow upstream after the timeout", async () => {
    const res = await proxyPublicSite(browserRequest("/s/acme-website"), {
      siteBaseUrl: BASE,
      timeoutMs: 20,
      fetchImpl: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    expect(res.status).toBe(502);
  });
});
