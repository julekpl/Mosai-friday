import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import {
  CORE_MODULES,
  MODULE_IDS,
  PLAN_MODULES,
} from "@/convex/lib/capabilities";
import { ModuleLandingView } from "@/pages/modules/ModuleLanding";
import {
  MODULE_LANDING_LIST,
  MODULE_LANDINGS,
  moduleAvailability,
  moduleLanding,
} from "@/pages/modules/module-landing-content";

function render(id: (typeof MODULE_IDS)[number]): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [`/modules/${id}`] },
      createElement(ModuleLandingView, { content: MODULE_LANDINGS[id] }),
    ),
  );
}

describe("module landing content", () => {
  it("has a landing page for every module in the capability registry, in registry order", () => {
    expect(MODULE_LANDING_LIST.map((m) => m.id)).toEqual([...MODULE_IDS]);
    for (const id of MODULE_IDS) expect(MODULE_LANDINGS[id].id).toBe(id);
  });

  it("resolves only real module ids", () => {
    expect(moduleLanding("promote")?.name).toBe("Promote");
    expect(moduleLanding("billing")).toBeNull();
    expect(moduleLanding("__proto__")).toBeNull();
    expect(moduleLanding(undefined)).toBeNull();
  });

  it("derives plan availability from PLAN_MODULES, not hand-written copy", () => {
    for (const id of MODULE_IDS) {
      const { core, lowestPlan } = moduleAvailability(id);
      expect(core).toBe(CORE_MODULES.includes(id));
      expect(PLAN_MODULES[lowestPlan]).toContain(id);
    }
    expect(moduleAvailability("understand").label).toMatch(/free plan/i);
    expect(moduleAvailability("sell").label).toBe(
      "Included from the Growth plan",
    );
  });

  it("only cross-links to other, real modules", () => {
    for (const m of MODULE_LANDING_LIST) {
      expect(m.connections.length).toBeGreaterThan(0);
      for (const link of m.connections) {
        expect(MODULE_IDS).toContain(link.module);
        expect(link.module).not.toBe(m.id);
      }
    }
  });

  it("makes no unverifiable claims (no counts, testimonials or guarantees of results)", () => {
    const banned =
      /\b(\d+\s?%|\d+x|guarantee[ds]? (results|growth)|trusted by|customers love|#1|best-in-class)\b/i;
    for (const m of MODULE_LANDING_LIST) {
      const text = JSON.stringify({ ...m, icon: undefined });
      expect(text).not.toMatch(banned);
    }
  });
});

describe("ModuleLandingView", () => {
  it.each(MODULE_IDS)("renders the %s page with one h1 and a sign-in CTA", (id) => {
    const html = render(id);
    const content = MODULE_LANDINGS[id];
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(content.headline.replace(/'/g, "&#x27;"));
    expect(html).toContain('href="/auth"');
    expect(html).toContain('id="main-content"');
    for (const link of content.connections) {
      expect(html).toContain(`href="/modules/${link.module}"`);
    }
    // Every other module is reachable from the page.
    for (const other of MODULE_IDS) {
      if (other !== id) expect(html).toContain(`href="/modules/${other}"`);
    }
  });

  it("shows the setup note only where a module needs the customer's own account", () => {
    expect(render("promote")).toContain("Good to know");
    expect(render("understand")).not.toContain("Good to know");
  });
});
