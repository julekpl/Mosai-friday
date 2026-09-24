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
