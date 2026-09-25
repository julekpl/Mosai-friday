/**
 * Remembers which project the owner last opened, so `/app` resumes it instead
 * of whichever project the list query happens to return first.
 *
 * Per-browser convenience only: storage can be empty or throw (private
 * windows, blocked site data), and every caller must work without it.
 */
const KEY = "mosai:lastProjectId";

/** The project `/app` should open: the last one used if it still exists, else the first. */
export function pickProjectToOpen(
  projectIds: readonly string[],
  lastProjectId: string | null,
): string | undefined {
  if (lastProjectId && projectIds.includes(lastProjectId)) return lastProjectId;
  return projectIds[0];
}

export function readLastProjectId(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function rememberLastProjectId(projectId: string): void {
  try {
    window.localStorage.setItem(KEY, projectId);
  } catch {
    // Storage unavailable: `/app` falls back to the first project.
  }
}
