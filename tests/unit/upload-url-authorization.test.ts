import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { newBackend, seedUser } from "./helpers";

/**
 * Regression: `files.generateUploadUrl` was a public `mutation` that called
 * `getAuthUserId(ctx)` and ignored the result (null for a signed-out caller),
 * so anyone could mint storage upload URLs and write arbitrary blobs to Convex
 * storage (storage abuse / cost). The audit exempted it as "self-scoped".
 *
 * Before the fix, the unauthenticated call below resolved with a URL (it took
 * no arguments, so `projectId` was not even required). It is now an
 * `orgMutation` that authorizes the project through `access.requireProject`.
 */

type ProjectId = Id<"projects">;

describe("files.generateUploadUrl — authentication and project scope", () => {
  it("refuses an unauthenticated caller and issues no URL", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { email: "alice@example.com" });
    const projectId = (await alice.as.mutation(api.projects.create, {
      name: "Alice project",
    })) as ProjectId;

    await expect(
      t.mutation(api.files.generateUploadUrl, { projectId }),
    ).rejects.toThrow(/Not signed in|Unauthorized|Not found/i);
  });

  it("refuses a signed-in caller from another organization", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { email: "alice@example.com" });
    const projectId = (await alice.as.mutation(api.projects.create, {
      name: "Alice project",
    })) as ProjectId;
    const bob = await seedUser(t, { email: "bob@example.com" });
    await bob.as.mutation(api.projects.create, { name: "Bob project" });

    await expect(
      bob.as.mutation(api.files.generateUploadUrl, { projectId }),
    ).rejects.toThrow();
  });

  it("issues a URL to a member of the project", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { email: "alice@example.com" });
    const projectId = (await alice.as.mutation(api.projects.create, {
      name: "Alice project",
    })) as ProjectId;

    const url = await alice.as.mutation(api.files.generateUploadUrl, { projectId });
    expect(typeof url).toBe("string");
    expect(url.length).toBeGreaterThan(0);
  });
});
