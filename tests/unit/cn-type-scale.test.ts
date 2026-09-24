import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn keeps the custom type scale", () => {
  it("does not drop a type-scale size when a text colour is present", () => {
    expect(cn("text-caption", "text-muted-foreground")).toBe(
      "text-caption text-muted-foreground",
    );
    expect(cn("text-small text-terminal-green")).toBe(
      "text-small text-terminal-green",
    );
  });

  it("still lets a later size override an earlier one", () => {
    expect(cn("text-caption", "text-body")).toBe("text-body");
    expect(cn("text-sm", "text-small")).toBe("text-small");
  });
});
