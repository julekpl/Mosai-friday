import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { classifySource } from "@/components/app/wizard/classifySource";
import { newBackend, seedUser } from "./helpers";

// U2: the three-question first run (docs/ux/first-run-blueprint.md §2–§3).

describe("Q2 source classifier", () => {
  it("treats blank input as nothing to read", () => {
    expect(classifySource("")).toEqual({ kind: "none" });
    expect(classifySource("   \t ")).toEqual({ kind: "none" });
  });

  it("recognises web addresses and normalizes them to https", () => {
    expect(classifySource("northside.co.uk")).toEqual({ kind: "website", url: "https://northside.co.uk" });
    expect(classifySource("  www.Northside.com/ ")).toEqual({ kind: "website", url: "https://www.northside.com" });
    expect(classifySource("http://northside.com/menu?x=1")).toEqual({ kind: "website", url: "https://northside.com/menu" });
    expect(classifySource("https://shop.example.org")).toEqual({ kind: "website", url: "https://shop.example.org" });
  });

  it("treats business names as a Google listing search", () => {
    expect(classifySource("Northside Coffee, Bristol")).toEqual({ kind: "listing", query: "Northside Coffee, Bristol" });
    expect(classifySource("Joe’s   Barbers")).toEqual({ kind: "listing", query: "Joe’s Barbers" });
    expect(classifySource("Northside")).toEqual({ kind: "listing", query: "Northside" });
  });

  it("does not treat something that only resembles an address as a website", () => {
    // A name with a dot and spaces is a name.
    expect(classifySource("St. Anne's Bakery")).toEqual({ kind: "listing", query: "St. Anne's Bakery" });
    // A scheme that is not web, or a host without a dot, cannot be scanned.
    expect(classifySource("ftp://files.example.com").kind).toBe("listing");
    expect(classifySource("http://localhost").kind).toBe("listing");
  });
});

describe("projects.create first-run answers", () => {
  it("stores the business type and goal", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const id = (await owner.as.mutation(api.projects.create, {
      name: "Northside Coffee",
      businessType: "walk_in",
      primaryGoal: "visits",
    })) as Id<"projects">;
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ name: "Northside Coffee", businessType: "walk_in", primaryGoal: "visits" });
  });

  it("needs only the name", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    const id = (await owner.as.mutation(api.projects.create, { name: "Studio" })) as Id<"projects">;
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.businessType).toBeUndefined();
    expect(row?.primaryGoal).toBeUndefined();
  });

  it("rejects values outside the lists and callers who are not signed in", async () => {
    const t = newBackend();
    const owner = await seedUser(t);
    await expect(
      owner.as.mutation(api.projects.create, {
        name: "Studio",
        // @ts-expect-error — not a business type
        businessType: "franchise",
      }),
    ).rejects.toThrow();
    await expect(t.mutation(api.projects.create, { name: "Studio", primaryGoal: "sales" })).rejects.toThrow();
  });
});
