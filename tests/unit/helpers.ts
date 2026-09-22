import { convexTest } from "convex-test";
import schema from "@/convex/schema";
import { modules } from "@/convex/test.setup";

/**
 * Shared helpers for the Phase 0 regression suite (MOSAI pack T1.7).
 *
 * This file is not a test (the Vitest `include` only picks up `*.test.ts`); it
 * exists so R1, R2, R3, R6, R8, R9 and R10 seed their tenants the same way.
 * Where a test needs a second tenant, it creates a *real* user row and signs in
 * as it — that is the whole point of the cross-tenant boundary, so nothing here
 * fakes an identity.
 */

export type TestBackend = ReturnType<typeof convexTest>;

export function newBackend(): TestBackend {
  return convexTest(schema, modules);
}

export type Tenant = {
  userId: string;
  /** The backend scoped to this user's identity. */
  as: ReturnType<TestBackend["withIdentity"]>;
};

/** Insert a real user row and return an identity-scoped backend for it. */
export async function seedUser(
  t: TestBackend,
  opts: { plan?: string; isAnonymous?: boolean } = {},
): Promise<Tenant> {
  const userId = await t.run((ctx) =>
    ctx.db.insert("users", {
      name: "Test user",
      plan: opts.plan ?? "free",
      isAnonymous: opts.isAnonymous ?? false,
    }),
  );
  return { userId, as: t.withIdentity({ subject: userId }) };
}

/** Insert a project owned by `ownerId` without going through a mutation. */
export async function seedProject(
  t: TestBackend,
  ownerId: string,
  name = "Test project",
): Promise<string> {
  return await t.run((ctx) =>
    ctx.db.insert("projects", { ownerId, name, createdAt: Date.now() }),
  );
}
