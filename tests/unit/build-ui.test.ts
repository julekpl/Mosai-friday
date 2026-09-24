import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Build module UX defects from docs/reviews/build-ux-review.md §1.3:
 *  - row 21: the delete dialog had a hidden trigger and never opened;
 *  - row 22: the open build lived only in React state (no URL);
 *  - rows 15/17 and P0-8: "live" / "published" wording for releases that are
 *    only prepared and not publicly served.
 *
 * Red-first record (24 Sep 2026): on the unfixed tree the delete buttons
 * rendered without `aria-haspopup="dialog"` (they only set local state), a
 * `?build=` URL rendered the list instead of the workspace, and PageEditor
 * contained "This version is now live".
 */

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: () => async () => undefined,
  useAction: () => async () => undefined,
}));

vi.mock("@/components/build/BuildWorkspace", () => ({
  BuildWorkspace: ({ build }: { build: { name: string } }) =>
    createElement("div", { "data-testid": "workspace" }, `workspace:${build.name}`),
}));

vi.mock("@/components/build/AppWorkspace", () => ({
  AppWorkspace: ({ build }: { build: { name: string } }) =>
    createElement("div", { "data-testid": "app-workspace" }, `app:${build.name}`),
}));

vi.mock("@/components/app/ContextInspector", () => ({
  ContextInspector: () => null,
}));

import Build from "@/pages/app/Build";
import { BuildList } from "@/components/build/BuildList";
import {
  resolveBuildSelection,
  withBuildSelection,
} from "@/components/build/buildSelection";
import {
  RELEASE_PREPARED_MESSAGE,
  pageStatusForDisplay,
  revisionStateForDisplay,
  siteStatusForDisplay,
} from "@/components/cms/releaseLabels";

const BUILDS = [
  {
    _id: "build_a",
    projectId: "project_1",
    name: "Bakery site",
    kind: "website" as const,
    status: "draft",
    createdAt: 1_700_000_000_000,
  },
  {
    _id: "build_b",
    projectId: "project_1",
    name: "Old site",
    kind: "website" as const,
    status: "published",
    createdAt: 1_700_000_000_000,
  },
];

function renderBuild(url: string) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [url] },
      createElement(Build, { projectId: "project_1" as never }),
    ),
  );
}

beforeEach(() => {
  useQueryMock.mockReset().mockReturnValue(BUILDS);
});

describe("build delete", () => {
  it("each delete button opens its own confirmation dialog", () => {
    const markup = renderToStaticMarkup(
      createElement(BuildList, {
        builds: BUILDS,
        onOpen: () => undefined,
        onDelete: async () => undefined,
      }),
    );
    for (const b of BUILDS) {
      const button = markup.match(
        new RegExp(`<button[^>]*aria-label="Delete ${b.name}"[^>]*>`),
      )?.[0];
      expect(button, `delete button for ${b.name}`).toBeDefined();
      expect(button).toContain('aria-haspopup="dialog"');
    }
  });

  it("the Build page renders the working delete triggers, not a hidden one", () => {
    const markup = renderBuild("/app/project_1/build");
    expect(markup).toContain('aria-label="Delete Bakery site"');
    expect(markup).not.toMatch(/<span class="hidden" aria-hidden/);
    const deleteButtons = markup.match(/aria-label="Delete [^"]+"[^>]*aria-haspopup="dialog"|aria-haspopup="dialog"[^>]*aria-label="Delete [^"]+"/g);
    expect(deleteButtons).toHaveLength(BUILDS.length);
  });
});

describe("the open build is in the URL", () => {
  it("opens the workspace for ?build=<id> from this project", () => {
    const markup = renderBuild("/app/project_1/build?build=build_a");
    expect(markup).toContain("workspace:Bakery site");
  });

  it("opens the management view for &view=manage", () => {
    const markup = renderBuild("/app/project_1/build?build=build_a&view=manage");
    expect(markup).toContain("Bakery site · manage");
  });

  it("refuses an id that is not in this project's build list", () => {
    const markup = renderBuild("/app/project_1/build?build=foreign_build");
    expect(markup).not.toContain("workspace:");
    expect(markup).toContain("This build isn&#x27;t available");
  });

  it("resolves selection and writes params without touching others", () => {
    const params = new URLSearchParams("tab=x&build=build_a&view=manage");
    expect(resolveBuildSelection(params, undefined)).toEqual({ kind: "loading" });
    expect(resolveBuildSelection(params, BUILDS)).toMatchObject({
      kind: "found",
      managing: true,
      build: { _id: "build_a" },
    });
    expect(resolveBuildSelection(new URLSearchParams(""), BUILDS)).toEqual({ kind: "none" });

    const closed = withBuildSelection(params, null);
    expect(closed.toString()).toBe("tab=x");
    const opened = withBuildSelection(closed, "build_b");
    expect(opened.get("build")).toBe("build_b");
    expect(opened.get("view")).toBeNull();
    expect(withBuildSelection(closed, "build_b", true).get("view")).toBe("manage");
  });
});

describe("release wording claims no more than the server knows", () => {
  it("maps stored release states to honest labels", () => {
    expect(pageStatusForDisplay("published")).toBe("prepared_for_release");
    expect(pageStatusForDisplay("draft")).toBe("draft");
    expect(revisionStateForDisplay("published")).toBe("latest_release");
    expect(revisionStateForDisplay("superseded")).toBe("superseded");
    expect(siteStatusForDisplay("live")).toBe("prepared_for_release");
    expect(siteStatusForDisplay("published")).toBe("prepared_for_release");
    expect(RELEASE_PREPARED_MESSAGE).toMatch(/not publicly served/);
    expect(RELEASE_PREPARED_MESSAGE).not.toMatch(/\blive\b/i);
  });

  it("the build list shows a legacy published build as prepared, not published", () => {
    const markup = renderBuild("/app/project_1/build");
    expect(markup).toContain("prepared for release");
    expect(markup).not.toMatch(/>\s*published\s*</);
  });

  it("PageEditor and SitePanel no longer say live or published for prepared releases", () => {
    const root = process.cwd();
    const editor = readFileSync(join(root, "src/components/cms/PageEditor.tsx"), "utf8");
    const panel = readFileSync(join(root, "src/components/cms/SitePanel.tsx"), "utf8");
    expect(editor).not.toContain("now live");
    expect(editor).not.toContain("Publish now");
    expect(editor).not.toContain('toast.success("Published"');
    expect(editor).toContain("revisionStateForDisplay(r.state)");
    expect(editor).toContain("pageStatusForDisplay(page.status)");
    expect(panel).toContain("<StatusBadge status={pageStatusForDisplay(p.status)} />");
    expect(panel).not.toContain("<StatusBadge status={p.status} />");
    expect(panel).not.toContain("/shop serves published pages");
  });
});
