import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: () => async () => undefined,
}));

import { AppBriefPanel } from "@/components/build/AppBriefPanel";
import { AppWorkspace } from "@/components/build/AppWorkspace";
import { briefGaps } from "@/components/build/appBriefGaps";

const build = {
  _id: "build_1" as never,
  projectId: "project_1" as never,
  name: "Example app",
  idea: "Help customers compare plans",
};

describe("app workspace (chat first)", () => {
  beforeEach(() => {
    // workspace, personas, journeys (then the brief panel's own queries).
    useQueryMock.mockReset().mockImplementation(() => undefined);
    useQueryMock
      .mockReturnValueOnce({ head: null, versions: [], runs: [] })
      .mockReturnValueOnce([{ name: "Pat", role: "Owner", goals: ["save time"] }])
      .mockReturnValueOnce([]);
  });

  it("opens on the chat with suggestions from the project, and is honest about limits", () => {
    const markup = renderToStaticMarkup(createElement(AppWorkspace, { build, onBack: () => undefined }));
    expect(markup).toContain("Build the first version: Help customers compare plans. Design it for Pat (Owner), who wants to save time.");
    expect(markup).toContain('for="app-prompt"');
    expect(markup).toContain("Nothing is published, and the app has no backend or deploy yet.");
    expect(markup).toContain("Your app appears here after the first message.");
    expect(markup).not.toContain("App generation and live preview aren’t available yet.");
  });
});

describe("app brief panel", () => {
  beforeEach(() => {
    useQueryMock
      .mockReset()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce(undefined);
  });

  it("starts with a guided idea step and says the brief is optional", () => {
    const markup = renderToStaticMarkup(createElement(AppBriefPanel, { build }));
    expect(markup).toContain('aria-label="App brief steps"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("What should your app help people do?");
    expect(markup).toContain("The brief is optional.");
    expect(markup).toContain("Help customers compare plans");
  });
});

describe("app brief gaps", () => {
  it("names the missing audience fields that keep Save brief disabled", () => {
    const gaps = briefGaps({ audience: "", goal: "Compare grocery prices", targetUsers: "", coreWorkflows: [] });
    expect(gaps.save.map((g) => g.label)).toEqual(["Who should use this app", "Describe the people who will use it"]);
    expect(gaps.save.every((g) => g.step === 1)).toBe(true);
    expect(gaps.review).toEqual([{ step: 2, label: "At least one workflow" }]);
  });

  it("reports nothing once the brief is complete", () => {
    expect(briefGaps({ audience: "both", goal: "x", targetUsers: "y", coreWorkflows: ["z"] })).toEqual({ save: [], review: [] });
  });
});
