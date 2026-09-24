export type SocialPostReadiness = {
  canExecute: boolean;
  state: "checking" | "connect" | "unavailable" | "ready";
};

/** Gate actions on the configured OAuth credential state reported by the server.
 * Provider availability and the final publish receipt are checked separately. */
export function getSocialPostReadiness(
  connection: { connected: boolean; configured: boolean } | null | undefined,
): SocialPostReadiness {
  if (connection === undefined) {
    return { canExecute: false, state: "checking" };
  }
  if (connection === null || !connection.configured) {
    return { canExecute: false, state: "unavailable" };
  }
  if (!connection.connected) {
    return { canExecute: false, state: "connect" };
  }
  return { canExecute: true, state: "ready" };
}
