/**
 * The open build lives in the URL (`?build=<id>`, plus `&view=manage` for the
 * management surface) so refresh, back and shared links keep the workspace.
 *
 * The id is validated against the project's own build list, which the server
 * already scopes to builds the caller may read (`builds.list`). An id from
 * another project, or a deleted build, resolves to `missing`, never to a row.
 */

export const BUILD_PARAM = "build";
export const VIEW_PARAM = "view";
export const MANAGE_VIEW = "manage";

export type BuildSelection<T> =
  | { kind: "none" }
  | { kind: "loading" }
  | { kind: "missing"; id: string }
  | { kind: "found"; build: T; managing: boolean };

export function resolveBuildSelection<T extends { _id: string }>(
  params: URLSearchParams,
  builds: readonly T[] | undefined,
): BuildSelection<T> {
  const id = params.get(BUILD_PARAM);
  if (!id) return { kind: "none" };
  if (builds === undefined) return { kind: "loading" };
  const build = builds.find((b) => b._id === id);
  if (!build) return { kind: "missing", id };
  return { kind: "found", build, managing: params.get(VIEW_PARAM) === MANAGE_VIEW };
}

/** Returns new search params that open `id` (or close the build when null),
 *  keeping every unrelated parameter. */
export function withBuildSelection(
  params: URLSearchParams,
  id: string | null,
  managing = false,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(VIEW_PARAM);
  if (id) {
    next.set(BUILD_PARAM, id);
    if (managing) next.set(VIEW_PARAM, MANAGE_VIEW);
  } else {
    next.delete(BUILD_PARAM);
  }
  return next;
}

/* ── One website and one app per project ─────────────────────────────── */

export type BuildKind = "website" | "app";

export const BUILD_KINDS: readonly BuildKind[] = ["website", "app"];

/** A project's slot for one build kind: the build shown as the project's
 *  website (or app), plus any older builds of the same kind. */
export type BuildSlot<T> = { primary: T | null; older: T[] };

type SlotRow = {
  _id: string;
  kind: BuildKind;
  createdAt: number;
  updatedAt?: number;
};

/**
 * Splits a project's builds into the website slot and the app slot.
 *
 * Since 24 Sep 2026 a project holds one website and one app
 * (`builds.create` refuses a second of a kind). Projects created earlier may
 * still hold several builds of one kind; nothing is deleted or migrated. The
 * most recently updated one is shown as the project's website/app, and the
 * rest are listed as older builds, newest first, so they can still be opened
 * or deleted.
 */
export function buildSlots<T extends SlotRow>(
  builds: readonly T[],
): Record<BuildKind, BuildSlot<T>> {
  const recency = (b: T) => b.updatedAt ?? b.createdAt;
  const slot = (kind: BuildKind): BuildSlot<T> => {
    const ofKind = builds
      .filter((b) => b.kind === kind)
      .sort(
        (a, b) =>
          recency(b) - recency(a) ||
          b.createdAt - a.createdAt ||
          (a._id < b._id ? 1 : a._id > b._id ? -1 : 0),
      );
    return { primary: ofKind[0] ?? null, older: ofKind.slice(1) };
  };
  return { website: slot("website"), app: slot("app") };
}
