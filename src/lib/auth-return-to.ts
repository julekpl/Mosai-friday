const ALLOWED_RETURN_PATHS = ["/dashboard", "/app", "/admin"] as const;

/** Keep post-auth navigation on known local application routes. */
export function resolveAuthReturnTo(
  candidate: string | null | undefined,
  fallback = "/dashboard",
): string {
  const safeFallback = isAllowedLocalPath(fallback) ? fallback : "/dashboard";
  if (
    !candidate ||
    candidate.includes("\\") ||
    hasControlCharacters(candidate)
  ) {
    return safeFallback;
  }

  try {
    const target = new URL(candidate, "https://mosai.invalid");
    if (
      target.origin !== "https://mosai.invalid" ||
      !isAllowedLocalPath(target.pathname)
    ) {
      return safeFallback;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return safeFallback;
  }
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint < 0x20;
  });
}

function isAllowedLocalPath(pathname: string): boolean {
  return ALLOWED_RETURN_PATHS.some(
    (path) =>
      pathname === path ||
      (path !== "/dashboard" && pathname.startsWith(`${path}/`)),
  );
}
