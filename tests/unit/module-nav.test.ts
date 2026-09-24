import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import {
  addModuleHref,
  addModuleStorageKey,
  ModuleNav,
  moduleNavBucket,
  NAV_MODULES,
  partitionModules,
} from "@/components/app/ModuleNav";
import type { CapabilityState } from "@/convex/lib/capabilities";

const ids = (list: readonly { to: string }[]) => list.map((m) => m.to);

function statesFrom(map: Record<string, CapabilityState>) {
  return (module: string): CapabilityState | null => map[module] ?? null;
}

describe("partitionModules", () => {
  it("splits by server state and keeps registry order in every bucket", () => {
    const partition = partitionModules(
      NAV_MODULES,
      statesFrom({
        understand: "included",
        journeys: "locked",
        create: "needs_setup",
        build: "included",
        customers: "unavailable",
        promote: "locked",
        sell: "needs_setup",
        grow: "unavailable",
      }),
    );

    expect(ids(partition.included)).toEqual(["understand", "build"]);
    expect(ids(partition.needsSetup)).toEqual(["create", "sell"]);
    expect(ids(partition.primary)).toEqual([
      "understand",
      "create",
      "build",
      "sell",
    ]);
    expect(ids(partition.addable)).toEqual(["journeys", "promote"]);
    expect(ids(partition.unavailable)).toEqual(["customers", "grow"]);
    expect(partition.unknown).toEqual([]);
  });

  it("never offers a module whose state is unknown", () => {
    const partition = partitionModules(NAV_MODULES, statesFrom({ grow: "included" }));
    expect(ids(partition.primary)).toEqual(["grow"]);
    expect(partition.addable).toEqual([]);
    expect(partition.unknown).toHaveLength(NAV_MODULES.length - 1);
  });

  it("maps each capability state to exactly one bucket", () => {
    expect(moduleNavBucket("included")).toBe("included");
    expect(moduleNavBucket("needs_setup")).toBe("needs_setup");
    expect(moduleNavBucket("locked")).toBe("addable");
    expect(moduleNavBucket("unavailable")).toBe("unavailable");
    expect(moduleNavBucket(null)).toBe("unknown");
  });

  it("routes an add request to billing and scopes storage per user", () => {
    expect(addModuleHref("sell")).toBe("/app/billing?module=sell");
    expect(addModuleStorageKey("user_1")).not.toBe(addModuleStorageKey("user_2"));
  });
});

function render(
  props: Partial<Parameters<typeof ModuleNav>[0]> &
    Pick<Parameters<typeof ModuleNav>[0], "stateOf">,
) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/app/p1/understand"] },
      createElement(ModuleNav, {
        variant: "desktop",
        projectId: "p1",
        loading: false,
        userId: "user_1",
        ...props,
      }),
    ),
  );
}

describe("ModuleNav", () => {
  it("shows a skeleton, not the module list, while entitlements load", () => {
    const markup = render({ loading: true, stateOf: () => null });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("Understand");
  });

  it("lists owned modules and collapses the rest under Add a module", () => {
    const markup = render({
      stateOf: statesFrom({
        understand: "included",
        journeys: "needs_setup",
        create: "locked",
        build: "locked",
        customers: "unavailable",
        promote: "locked",
        sell: "locked",
        grow: "locked",
      }),
    });
    expect(markup).toContain('href="/app/p1/understand"');
    expect(markup).toContain('href="/app/p1/journeys"');
    expect(markup).toContain("needs setup");
    expect(markup).toContain("Add a module");
    expect(markup).toContain("(6)");
    expect(markup).toContain('aria-expanded="false"');
    // Locked modules never link into the module itself.
    expect(markup).not.toContain('href="/app/p1/create"');
  });

  it("opens the add section and explains itself when nothing is owned", () => {
    const markup = render({
      stateOf: statesFrom({
        understand: "locked",
        journeys: "locked",
        create: "locked",
        build: "locked",
        customers: "locked",
        promote: "locked",
        sell: "unavailable",
        grow: "locked",
      }),
    });
    expect(markup).toContain("No modules yet");
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('href="/app/billing?module=understand"');
    // Unavailable modules are shown but never offered as a purchase.
    expect(markup).not.toContain('href="/app/billing?module=sell"');
  });
});
