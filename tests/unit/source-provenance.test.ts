import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import { newBackend, seedUser } from "./helpers";

const originalSerpKey = process.env.SERPAPI_KEY;
const originalNewsKey = process.env.NEWSAPI_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalSerpKey === undefined) delete process.env.SERPAPI_KEY;
  else process.env.SERPAPI_KEY = originalSerpKey;
  if (originalNewsKey === undefined) delete process.env.NEWSAPI_KEY;
  else process.env.NEWSAPI_KEY = originalNewsKey;
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function research() {
  const backend = newBackend();
  const { as } = await seedUser(backend, { plan: "scale" });
  return await as.action(api.research.researchTopic, { query: "sample topic" });
}

describe("research source provenance", () => {
  it("distinguishes missing credentials from empty results", async () => {
    delete process.env.SERPAPI_KEY;
    delete process.env.NEWSAPI_KEY;
    const requestedHosts: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requestedHosts.push(url.hostname);
      if (url.hostname === "www.reddit.com") return json({ data: { children: [] } });
      if (url.hostname.endsWith("wikipedia.org") || url.hostname.endsWith("wikibooks.org")) {
        return json({ query: { search: [] } });
      }
      if (url.hostname === "api.gdeltproject.org") return json({ articles: [] });
      if (url.hostname === "www.googleapis.com") return json({ items: [] });
      throw new Error("Unexpected provider request");
    });

    const result = await research();
    const byProvider = new Map(result.sources.map((source) => [source.provider, source]));

    expect(byProvider.get("reddit")?.status).toBe("empty");
    expect(byProvider.get("gdlt")?.status).toBe("empty");
    expect(byProvider.get("youtube")?.status).toBe("needs_setup");
    expect(byProvider.get("newsapi")?.status).toBe("needs_setup");
    expect(byProvider.get("trends")?.status).toBe("needs_setup");
    expect(byProvider.get("local_news")?.status).toBe("needs_setup");
    expect(byProvider.get("serp_news")?.status).toBe("needs_setup");
    expect(byProvider.get("reddit")?.retrievedAt).toEqual(expect.any(Number));
    expect(requestedHosts).not.toContain("serpapi.com");
    expect(requestedHosts).not.toContain("newsapi.org");
  });

  it("reports timeout, rate limit and partial success without provider error text", async () => {
    process.env.SERPAPI_KEY = "fixture-serp-secret";
    process.env.NEWSAPI_KEY = "fixture-news-secret";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "www.reddit.com") {
        const error = new Error("fixture timed out");
        error.name = "AbortError";
        throw error;
      }
      if (url.hostname === "en.wikipedia.org") return json({ query: { search: [{ title: "Fixture result", snippet: "A useful excerpt" }] } });
      if (url.hostname === "en.wikibooks.org") return json({ query: { search: [] } });
      if (url.hostname === "api.gdeltproject.org") return json({ secret: "provider body must stay private" }, 429);
      if (url.hostname === "www.googleapis.com") return json({ items: [] });
      if (url.hostname === "newsapi.org") return json({ error: "provider token fixture-news-secret" }, 503);
      if (url.hostname === "serpapi.com") {
        switch (url.searchParams.get("engine")) {
          case "youtube":
            return json({ video_results: [{ title: "Fixture video", link: "https://youtube.com/watch?v=abc123" }] });
          case "google_trends":
            return json({ related_queries: { rising: [] } });
          case "google":
            return json({ news_results: [{ title: "Local fixture", link: "https://example.test/local" }] });
          case "google_news":
            return json({ news_results: [] });
        }
      }
      throw new Error("Unexpected provider request");
    });

    const result = await research();
    const byProvider = new Map(result.sources.map((source) => [source.provider, source]));

    expect(byProvider.get("reddit")).toMatchObject({ status: "failed", errorCategory: "timeout", hits: [] });
    expect(byProvider.get("gdlt")).toMatchObject({ status: "rate_limited", errorCategory: "rate_limit", hits: [] });
    expect(byProvider.get("newsapi")).toMatchObject({ status: "failed", errorCategory: "provider_error", hits: [] });
    expect(byProvider.get("wikipedia")?.status).toBe("ok");
    expect(byProvider.get("youtube")?.status).toBe("ok");
    expect(byProvider.get("trends")?.status).toBe("empty");
    expect(result.hits.map((hit) => hit.title)).toContain("Fixture result");
    expect(result.hits.map((hit) => hit.title)).toContain("Fixture video");
    expect(JSON.stringify(result)).not.toContain("fixture-serp-secret");
    expect(JSON.stringify(result)).not.toContain("fixture-news-secret");
    expect(JSON.stringify(result)).not.toContain("provider body must stay private");
    expect(JSON.stringify(result)).not.toContain("provider token");
  });

  it("does not label HTTP 200 provider errors or malformed payloads as empty", async () => {
    process.env.SERPAPI_KEY = "fixture-serp-secret";
    process.env.NEWSAPI_KEY = "fixture-news-secret";
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "www.reddit.com") return json({ data: { children: [] } });
      if (url.hostname === "en.wikipedia.org") return json({});
      if (url.hostname === "en.wikibooks.org") {
        return new Response("malformed private response", { status: 200 });
      }
      if (url.hostname === "api.gdeltproject.org") return json({ articles: [] });
      if (url.hostname === "www.googleapis.com") return json({ items: [] });
      if (url.hostname === "newsapi.org") {
        return json({ status: "error", code: "fixture_error", message: "private provider detail" });
      }
      if (url.hostname === "serpapi.com") {
        switch (url.searchParams.get("engine")) {
          case "youtube": return json({ video_results: [] });
          case "google_trends": return json({ related_queries: { rising: [] } });
          case "google":
          case "google_news": return json({ news_results: [] });
        }
      }
      throw new Error("Unexpected provider request");
    });

    const result = await research();
    const byProvider = new Map(result.sources.map((source) => [source.provider, source]));

    expect(byProvider.get("newsapi")).toMatchObject({
      status: "failed",
      errorCategory: "provider_error",
      hits: [],
    });
    expect(byProvider.get("wikipedia")).toMatchObject({
      status: "failed",
      errorCategory: "invalid_response",
      hits: [],
    });
    expect(byProvider.get("wikibooks")).toMatchObject({
      status: "failed",
      errorCategory: "invalid_response",
      hits: [],
    });
    expect(byProvider.get("reddit")?.status).toBe("empty");
    expect(JSON.stringify(result)).not.toContain("private provider detail");
    expect(JSON.stringify(result)).not.toContain("malformed private response");
  });
});
