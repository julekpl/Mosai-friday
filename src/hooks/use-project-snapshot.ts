import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ProjectSnapshot } from "@/convex/ai";

/**
 * Builds the AI-ready project snapshot (details + file excerpts) from
 * reactive queries. Pass `projectId` or skip when the project isn't loaded.
 */
export function useProjectSnapshot(
  projectId: Id<"projects"> | undefined,
  opts: { skipFiles?: boolean } = {},
): {
  project: ReturnType<typeof useQuery<typeof api.projects.get>> | undefined;
  snapshot: ProjectSnapshot | undefined;
} {
  const project = useQuery(
    api.projects.get,
    projectId ? { id: projectId } : "skip",
  );
  const files = useQuery(
    api.files.list,
    projectId && !opts.skipFiles ? { projectId } : "skip",
  );

  if (!project) return { project, snapshot: undefined };

  const snapshot: ProjectSnapshot = {
    name: project.name,
    industry: project.industry,
    description: project.description,
    websiteUrl: project.websiteUrl,
    productsServices: project.productsServices,
    goals: project.goals,
    competitors: project.competitors,
    gmbTitle: project.websiteScan?.gmb?.title,
    gmbCategory: project.websiteScan?.gmb?.category,
    gmbRating: project.websiteScan?.gmb?.rating,
    gmbReviews: project.websiteScan?.gmb?.reviews,
    fileExcerpts: (files ?? [])
      .slice(0, 8)
      .map((f) => `- ${f.name}: ${(f.excerpt ?? "(no text extracted)").slice(0, 600)}`),
  };

  return { project, snapshot };
}
