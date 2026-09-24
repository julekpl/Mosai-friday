import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({ useQuery: useQueryMock }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { email: "operator@example.test" },
    signOut: async () => {},
  }),
}));

vi.mock("@/hooks/use-module-entitlements", () => ({
  capabilityStateLabel: (state: string) => state,
  useModuleEntitlements: () => ({
    plan: "growth",
    stateOf: () => "included",
  }),
}));

vi.mock("@/components/ui/sheet", async () => {
  const React = await import("react");
  const passthrough = ({ children }: { children: ReactNode }) =>
    React.createElement(React.Fragment, null, children);
  return {
    Sheet: passthrough,
    SheetClose: passthrough,
    SheetContent: ({ children }: { children: ReactNode }) =>
      React.createElement("div", { "data-mobile-navigation": true }, children),
    SheetDescription: passthrough,
    SheetHeader: passthrough,
    SheetTitle: passthrough,
    SheetTrigger: passthrough,
  };
});

import { AppShell } from "@/components/app/AppShell";

describe("mobile app navigation", () => {
  beforeEach(() => {
    useQueryMock
      .mockReset()
      .mockReturnValueOnce({ isAdmin: true })
      .mockReturnValueOnce([{ _id: "project_1", name: "Example workspace" }]);
  });

  it("exposes every module and account action and announces the current location", () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/app/project_1/journeys"] },
        createElement(AppShell, null, createElement("p", null, "Workspace")),
      ),
    );
    const mobileMenu = markup.split('data-mobile-navigation="true"')[1];

    expect(mobileMenu).toBeDefined();
    expect(markup).toContain('aria-label="Open navigation menu"');
    expect(mobileMenu).toContain("Current location: Journeys");
    for (const label of [
      "Understand",
      "Journeys",
      "Create",
      "Build",
      "Customers",
      "Promote",
      "Sell",
      "Grow",
      "Plan &amp; billing",
      "Platform admin",
      "Sign out",
    ]) {
      expect(mobileMenu).toContain(label);
    }
    expect(mobileMenu).toContain('aria-current="page"');
  });

  it("only exposes platform administration to an administrator", () => {
    useQueryMock
      .mockReset()
      .mockReturnValueOnce({ isAdmin: false })
      .mockReturnValueOnce([{ _id: "project_1", name: "Example workspace" }]);
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ["/app/project_1"] },
        createElement(AppShell, null, createElement("p", null, "Workspace")),
      ),
    );
    const mobileMenu = markup.split('data-mobile-navigation="true"')[1];

    expect(mobileMenu).toBeDefined();
    expect(mobileMenu).not.toContain("Platform admin");
  });
});
