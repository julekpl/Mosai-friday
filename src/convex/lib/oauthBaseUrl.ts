/** OAuth redirects must be rooted at a deployment-configured origin. */
export function configuredOAuthBaseUrl(
  value: string | undefined,
): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const localHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username !== "" ||
      url.password !== "" ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}
