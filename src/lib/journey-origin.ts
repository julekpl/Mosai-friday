/** The origin of a newly created journey map, independent of UI busy state. */
export function journeySourceForNewMap(aiDraftGenerated: boolean): "ai" | "manual" {
  return aiDraftGenerated ? "ai" : "manual";
}
