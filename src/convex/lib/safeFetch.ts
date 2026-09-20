import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PRIVATE_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home",
  ".lan",
  ".arpa",
];

type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedContentTypes?: readonly string[];
  headers?: Record<string, string>;
};

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return parts.reduce((value, part) => value * 256 + part, 0) >>> 0;
}

function inIpv4Range(address: number, base: string, bits: number): boolean {
  const baseNumber = ipv4ToNumber(base);
  if (baseNumber === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (baseNumber & mask);
}

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPublicIpAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const numeric = ipv4ToNumber(address);
    return (
      numeric !== null &&
      !BLOCKED_IPV4_RANGES.some(([base, bits]) =>
        inIpv4Range(numeric, base, bits),
      )
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isPublicIpAddress(mapped);

    // Public global-unicast IPv6 addresses are within 2000::/3. Explicitly
    // exclude documentation space as it should never be a crawl target.
    return /^[23][0-9a-f]{3}:/.test(normalized) && !normalized.startsWith("2001:db8:");
  }

  return false;
}

export async function assertPublicHttpUrl(input: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid website URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS websites can be scanned");
  }
  if (url.username || url.password) {
    throw new Error("Website URLs cannot contain credentials");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new Error("Non-standard website ports are not allowed");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    hostname === "localhost" ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new Error("Private network addresses cannot be scanned");
  }

  const literalVersion = isIP(hostname);
  if (literalVersion) {
    if (!isPublicIpAddress(hostname)) {
      throw new Error("Private or reserved network addresses cannot be scanned");
    }
    return url;
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Website hostname could not be resolved");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("Website hostname resolves to a private or reserved address");
  }

  return url;
}

async function readTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("Website response is too large");
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Website response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchTextSafely(
  input: string,
  options: SafeFetchOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const allowedContentTypes = options.allowedContentTypes ?? [
    "text/html",
    "text/plain",
    "application/xml",
    "text/xml",
    "application/xhtml+xml",
  ];

  let current = input;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const safeUrl = await assertPublicHttpUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(safeUrl, {
        headers: options.headers,
        signal: controller.signal,
        redirect: "manual",
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Website returned an invalid redirect");
        if (redirects === maxRedirects) throw new Error("Website redirected too many times");
        current = new URL(location, safeUrl).toString();
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
      if (contentType && !allowedContentTypes.includes(contentType)) {
        throw new Error(`Unsupported website content type: ${contentType}`);
      }
      return await readTextWithLimit(response, maxBytes);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error("Website redirected too many times");
}
