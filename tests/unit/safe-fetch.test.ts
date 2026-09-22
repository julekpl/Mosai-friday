import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetch } from "@/convex/lib/safeFetch";

/**
 * R5 — `safeFetch` blocks internal targets (MOSAI pack T1.7 / T0.5).
 *
 * Pure unit test: no network, no DNS. Hosts are IP literals or blocked host
 * names, so the guard resolves them locally; the two cases that would otherwise
 * need the network (a normal site, and a redirect) stub `fetch`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const body = (text: string, init: ResponseInit = {}) =>
  new Response(text, { status: 200, ...init });

describe("R5 — safeFetch blocks internal targets", () => {
  it("refuses non-HTTPS schemes", async () => {
    await expect(safeFetch("http://example.com/")).rejects.toThrow(
      /Only https:\/\//,
    );
  });

  it("refuses the localhost hostname without a DNS lookup", async () => {
    await expect(safeFetch("https://localhost/")).rejects.toThrow(/Blocked host/);
    await expect(safeFetch("https://intranet.local/")).rejects.toThrow(
      /Blocked host/,
    );
    await expect(safeFetch("https://metadata.internal/")).rejects.toThrow(
      /Blocked host/,
    );
  });

  it.each([
    ["loopback", "https://127.0.0.1/"],
    ["private 10/8", "https://10.0.0.1/"],
    ["private 172.16/12", "https://172.16.0.1/"],
    ["private 192.168/16", "https://192.168.1.1/"],
    ["CGNAT", "https://100.64.0.1/"],
    ["link-local / cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["IPv6 loopback", "https://[::1]/"],
    ["IPv6 unique-local", "https://[fc00::1]/"],
    ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/"],
  ])("refuses the %s address", async (_label, url) => {
    await expect(safeFetch(url)).rejects.toThrow(/Blocked/);
  });

  it("allows a public address and returns the body", async () => {
    vi.stubGlobal("fetch", async () => body("hello"));
    const res = await safeFetch("https://93.184.216.34/");
    expect(res.ok).toBe(true);
    expect(res.text).toBe("hello");
  });

  it("re-validates every redirect hop and refuses one to a private address", async () => {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.includes("169.254.169.254")) {
        throw new Error("The guard should never have issued this request");
      }
      return new Response("", {
        status: 302,
        headers: { location: "https://169.254.169.254/latest/meta-data/" },
      });
    });

    await expect(safeFetch("https://93.184.216.34/")).rejects.toThrow(
      /Blocked address/,
    );
  });

  it("refuses a redirect that downgrades to http", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "http://93.184.216.34/" },
        }),
    );
    await expect(safeFetch("https://93.184.216.34/")).rejects.toThrow(
      /Refusing redirect/,
    );
  });
});
