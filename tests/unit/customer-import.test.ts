import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { newBackend, seedUser } from "./helpers";
import { parseCustomerCsv } from "@/lib/customerCsv";

describe("BP-17/S1a customer import and consent truth", () => {
  it("does not let a caller grant marketing consent with a boolean", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Consent test",
    });

    await expect(
      owner.as.mutation(api.contacts.create, {
        projectId,
        email: "person@example.com",
        consentMarketing: true,
      } as never),
    ).rejects.toThrow();
    const contactId = await owner.as.mutation(api.contacts.create, {
      projectId,
      email: "person@example.com",
    });
    await expect(
      owner.as.mutation(api.contacts.update, {
        id: contactId,
        consentMarketing: true,
      } as never),
    ).rejects.toThrow();
  });

  it("normalizes email and makes repeated imports idempotent without granting consent", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Import test",
    });

    const first = await owner.as.mutation(api.contacts.create, {
      projectId,
      email: "  Person@Example.COM ",
      name: "First value",
      tags: ["imported"],
    });
    await t.run(async (ctx) =>
      ctx.db.patch(first as Id<"contacts">, {
        consent: { marketing: true, updatedAt: 1, source: "legacy" },
      }),
    );
    const second = await owner.as.mutation(api.contacts.create, {
      projectId,
      email: "person@example.com",
      name: "Replacement value",
      tags: ["imported"],
    });

    expect(second).toBe(first);
    const contacts = await owner.as.query(api.contacts.list, { projectId });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      email: "person@example.com",
      name: "First value",
      tags: ["imported"],
      consent: { marketing: true, updatedAt: 1, source: "legacy" },
    });
  });

  it("rejects a same-project email collision on update", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Update test",
    });
    const first = await owner.as.mutation(api.contacts.create, {
      projectId,
      email: "first@example.com",
    });
    const second = await owner.as.mutation(api.contacts.create, {
      projectId,
      email: "second@example.com",
    });

    await expect(
      owner.as.mutation(api.contacts.update, {
        id: second,
        email: " FIRST@example.com ",
      }),
    ).rejects.toThrow("A contact with this email already exists");
    const rows = await owner.as.query(api.contacts.list, { projectId });
    expect(rows.find((row) => row._id === first)?.email).toBe(
      "first@example.com",
    );
    expect(rows.find((row) => row._id === second)?.email).toBe(
      "second@example.com",
    );
  });

  it("imports a bounded batch atomically with exact duplicate and invalid counts, never consent", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Batch test",
    });
    const existingId = await owner.as.mutation(api.contacts.create, {
      projectId,
      email: "existing@example.com",
      name: "Keep this name",
    });
    await t.run((ctx) =>
      ctx.db.patch(existingId as Id<"contacts">, {
        consent: { marketing: true, updatedAt: 5, source: "legacy" },
      }),
    );

    const rows = [
      { email: "new@example.com", name: "New" },
      { email: " NEW@example.com ", name: "Duplicate row" },
      { email: "existing@example.com", name: "Do not overwrite" },
      { email: "not-an-email" },
    ];
    const firstReceipt = await owner.as.mutation(api.contacts.importBatch, {
      projectId,
      rows,
    });
    expect(firstReceipt).toEqual({ inserted: 1, skipped: 2, invalid: 1 });
    const secondReceipt = await owner.as.mutation(api.contacts.importBatch, {
      projectId,
      rows,
    });
    expect(secondReceipt).toEqual({ inserted: 0, skipped: 3, invalid: 1 });

    const contacts = await owner.as.query(api.contacts.list, { projectId });
    expect(contacts).toHaveLength(2);
    expect(
      contacts.find((contact) => contact.email === "existing@example.com"),
    ).toMatchObject({
      name: "Keep this name",
      consent: { marketing: true, updatedAt: 5, source: "legacy" },
    });
    expect(
      contacts.find((contact) => contact.email === "new@example.com")?.consent,
    ).toBeUndefined();
  });

  it("rejects oversized and foreign-project batches before writing", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const foreign = await seedUser(t, {
      email: "foreign@example.com",
      plan: "starter",
    });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Batch owner",
    });
    const foreignProjectId = await foreign.as.mutation(api.projects.create, {
      name: "Foreign batch",
    });
    const tooMany = Array.from({ length: 101 }, (_, index) => ({
      email: `person${index}@example.com`,
    }));

    await expect(
      owner.as.mutation(api.contacts.importBatch, { projectId, rows: tooMany }),
    ).rejects.toThrow("at most 100");
    await expect(
      owner.as.mutation(api.contacts.importBatch, {
        projectId: foreignProjectId,
        rows: [{ email: "person@example.com" }],
      }),
    ).rejects.toThrow();
    await expect(
      owner.as.mutation(api.contacts.importBatch, {
        projectId,
        rows: [{ email: "person@example.com", consentMarketing: true }],
      } as never),
    ).rejects.toThrow();
    const foreignRows = await t.run((ctx) =>
      ctx.db
        .query("contacts")
        .withIndex("by_project", (q) =>
          q.eq("projectId", foreignProjectId as Id<"projects">),
        )
        .collect(),
    );
    expect(foreignRows).toHaveLength(0);
  });

  it("parses quoted CSV values and enforces import bounds", () => {
    expect(
      parseCustomerCsv('name,email\n"Doe, Jane",Jane@Example.com'),
    ).toEqual({
      headers: ["name", "email"],
      rows: [["Doe, Jane", "Jane@Example.com"]],
    });
    expect(() =>
      parseCustomerCsv('name,email\n"Unclosed, x@example.com'),
    ).toThrow("unclosed quoted");
    expect(() =>
      parseCustomerCsv("name,email\nJane,jane@example.com,unexpected"),
    ).toThrow("match the CSV header");
  });

  it("does not deduplicate across projects and rejects foreign project writes", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "starter" });
    const other = await seedUser(t, {
      email: "other@example.com",
      plan: "starter",
    });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Owner project",
    });
    const otherProject = await other.as.mutation(api.projects.create, {
      name: "Other project",
    });

    const ownContact = await owner.as.mutation(api.contacts.create, {
      projectId,
      email: "shared@example.com",
    });
    const otherContact = await other.as.mutation(api.contacts.create, {
      projectId: otherProject,
      email: "shared@example.com",
    });

    expect(otherContact).not.toBe(ownContact);
    await expect(
      owner.as.mutation(api.contacts.create, {
        projectId: otherProject,
        email: "foreign@example.com",
      }),
    ).rejects.toThrow();
    const foreignRows = await t.run((ctx) =>
      ctx.db
        .query("contacts")
        .withIndex("by_project", (q) =>
          q.eq("projectId", otherProject as Id<"projects">),
        )
        .collect(),
    );
    expect(foreignRows).toHaveLength(1);
  });
});
