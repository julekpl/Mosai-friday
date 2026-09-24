import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: () => async () => undefined,
}));

import { AppWorkspace } from "@/components/build/AppWorkspace";

describe("app brief workspace", () => {
  beforeEach(() => {
    useQueryMock
      .mockReset()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce(undefined);
  });

  it("starts with a guided idea step and states the limits of the brief", () => {
    const markup = renderToStaticMarkup(createElement(AppWorkspace, {
      build: {
        _id: "build_1" as never,
        projectId: "project_1" as never,
        name: "Example app",
        idea: "Help customers compare plans",
      },
      onBack: () => undefined,
    }));

    expect(markup).toContain('aria-label="App brief steps"');
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("What should your app help people do?");
    expect(markup).toContain("App generation and live preview aren’t available yet.");
    expect(markup).toContain("Help customers compare plans");
    expect(markup).toContain("Continue");
    expect(markup).not.toContain("Requirements workspace only");
  });
});

import { briefGaps } from "@/components/build/appBriefGaps";

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
