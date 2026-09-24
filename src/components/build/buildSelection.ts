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
