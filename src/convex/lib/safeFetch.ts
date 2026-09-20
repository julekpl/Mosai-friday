"use node";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/* ── SSRF-safe outbound fetch ────────────────────────────────────────────
 *
 * User-supplied URLs (website scans, robots.txt `Sitemap:` hints, imported
 * sources) must never be allowed to reach our own network. `safeFetch`
 * enforces, on every hop:
 *
 *   - HTTPS only (no http:, no file:, no gopher: …)
 *   - the hostname must resolve to a public address — loopback, private,
 *     link-local, CGNAT, multicast, reserved and cloud-metadata ranges are
 *     refused (after DNS resolution, not just by hostname string)
 *   - redirects are followed manually and re-validated on each hop, so a
 *     public URL cannot bounce into `169.254.169.254` or `localhost`
 *   - bounded response size and wall-clock time
 *   - no credentials forwarded (only the headers the caller sets)
 *
 * Residual risk: Node's fetch does its own DNS lookup after ours, so a
 * determined DNS-rebinding attacker could in principle race the two. Pinning
 * the resolved IP via a custom dispatcher is the next step if that threat
 * matters; the resolver check below already closes the documented attacks.
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_BYTES = 5_000_000;
const DEFAULT_MAX_REDIRECTS = 5;

/** [network base, CIDR prefix] for IPv4 ranges that must never be reached. */
const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network" / default route
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. cloud metadata 169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved / broadcast
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function ipv4InCidr(ip: string, base: string, prefix: number): boolean {
  const a = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (a === null || b === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (a & mask) === (b & mask);
}

/** Expand an IPv6 literal to its eight 16-bit groups. */
function ipv6ToGroups(ip: string): number[] | null {
  let s = ip.trim().toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone); // drop zone id

  // Fold a trailing embedded IPv4 (e.g. ::ffff:1.2.3.4) into two hex groups.
  const v4 = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    if (n === null) return null;
    s = `${s.slice(0, v4.index)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (str: string): number[] | null => {
    if (str === "") return [];
    const out: number[] = [];
    for (const g of str.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;

  const tail = parseGroups(halves[1]);
  if (!tail) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function isBlockedIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return BLOCKED_V4.some(([base, prefix]) => ipv4InCidr(ip, base, prefix));
  }
  if (version !== 6) return true; // not an address — fail closed

  const g = ipv6ToGroups(ip);
  if (!g) return true;
  const [g0, g1, , , , g5, g6, g7] = g;

  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g7 === 1) return true; // ::1

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible → judge the embedded v4.
  if (g.slice(0, 5).every((x) => x === 0) && (g5 === 0xffff || g5 === 0)) {
    return isBlockedIp(intToV4((g6 << 16) | g7));
  }
  // NAT64 well-known prefix 64:ff9b::/96 → judge the embedded v4.
  if (g0 === 0x64 && g1 === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIp(intToV4((g6 << 16) | g7));
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return true; // 6to4 (embeds an arbitrary v4)
  return false;
}

function intToV4(n: number): string {
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/** Resolve a hostname and refuse anything that is not clearly public. */
async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (host === "" || host === "localhost") {
    throw new Error(`Blocked host: ${hostname}`);
  }
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`Blocked address: ${hostname}`);
    return;
  }
  if (
    !host.includes(".") ||
    BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))
  ) {
    throw new Error(`Blocked host: ${hostname}`);
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve host: ${hostname}`);
  }
  if (addresses.length === 0) throw new Error(`Could not resolve host: ${hostname}`);
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new Error(`Blocked address for ${hostname}: ${address}`);
    }
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
};

export type SafeFetchResult = {
  status: number;
  ok: boolean;
  text: string;
  url: string;
};

/**
 * Fetch a user-supplied URL with SSRF protections. Throws on any blocked
 * host, non-HTTPS URL, redirect loop, timeout or transport failure.
 */
export async function safeFetch(
  input: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    headers = {},
  } = opts;

  let current: URL;
  try {
    current = new URL(input);
  } catch {
    throw new Error(`Invalid URL: ${input}`);
  }
  if (current.protocol !== "https:") {
    throw new Error(`Only https:// URLs are allowed (got ${current.protocol})`);
  }

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHost(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        headers: { accept: "*/*", ...headers },
        signal: controller.signal,
        redirect: "manual",
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Redirect without a Location header (HTTP ${res.status})`);
      current = new URL(location, current); // resolved then re-validated next hop
      if (current.protocol !== "https:") {
        throw new Error(`Refusing redirect to ${current.protocol}`);
      }
      continue;
    }

    const text = await readLimited(res, maxBytes);
    return { status: res.status, ok: res.ok, text, url: current.toString() };
  }

  throw new Error(`Too many redirects (> ${maxRedirects})`);
}
