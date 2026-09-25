import { describe, expect, it } from "vitest";

import { pickProjectToOpen } from "@/lib/last-project";

describe("/app resumes the last project", () => {
  it("opens the last project the owner used when it still exists", () => {
    expect(pickProjectToOpen(["a", "b", "c"], "c")).toBe("c");
  });

  it("falls back to the first project when nothing was remembered", () => {
    expect(pickProjectToOpen(["a", "b"], null)).toBe("a");
  });

  it("ignores a remembered project that was deleted or belongs to another organization", () => {
    expect(pickProjectToOpen(["a", "b"], "gone")).toBe("a");
  });

  it("opens nothing when there are no projects", () => {
    expect(pickProjectToOpen([], "a")).toBeUndefined();
  });
});
