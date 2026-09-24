import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import { newBackend, seedUser } from "./helpers";

describe("BP-14/S1 catalog truth", () => {
  it("rejects collections from another project on create and update", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Shop" });
    const otherProjectId = await owner.as.mutation(api.projects.create, { name: "Other shop" });
    const collectionId = await owner.as.mutation(api.collections.create, {
      projectId: otherProjectId,
      title: "Private collection",
    });

    await expect(owner.as.mutation(api.products.create, {
      projectId,
      title: "New item",
      collectionIds: [collectionId],
    })).rejects.toThrow();

    const productId = await owner.as.mutation(api.products.create, { projectId, title: "Local item" });
    await expect(owner.as.mutation(api.products.update, {
      id: productId,
      collectionIds: [collectionId],
    })).rejects.toThrow();
    expect((await owner.as.query(api.products.listWithReadiness, { projectId }))[0].collectionIds).toBeUndefined();
  });

  it("accepts only nonnegative integer prices and inventory counts", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Shop" });

    for (const priceCents of [-1, 1.5]) {
      await expect(owner.as.mutation(api.products.create, {
        projectId,
        title: "Invalid price",
        priceCents,
      })).rejects.toThrow();
    }
    for (const inventoryCount of [-1, 1.5]) {
      await expect(owner.as.mutation(api.products.create, {
        projectId,
        title: "Invalid stock",
        inventoryCount,
      })).rejects.toThrow();
    }

    const productId = await owner.as.mutation(api.products.create, {
      projectId,
      title: "Valid item",
      priceCents: 0,
      inventoryCount: 0,
    });
    await expect(owner.as.mutation(api.products.create, {
      projectId,
      title: "Inconsistent stock",
      inventoryCount: 0,
      availability: "in_stock",
    })).rejects.toThrow();
    await expect(owner.as.mutation(api.variants.updateDefault, {
      productId,
      priceCents: 1.5,
    })).rejects.toThrow();
    await expect(owner.as.mutation(api.variants.updateDefault, {
      productId,
      compareAtPriceCents: -1,
    })).rejects.toThrow();
    await owner.as.mutation(api.variants.updateDefault, {
      productId,
      inventoryCount: 2,
    });
    const [updated] = await owner.as.query(api.products.listWithReadiness, { projectId });
    expect(updated.variants[0]).toMatchObject({ inventoryCount: 2, availability: "in_stock" });
  });

  it("validates explicit variants and keeps native lifecycle local", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Shop" });
    const productId = await owner.as.mutation(api.products.create, {
      projectId,
      title: "Active local item",
      status: "active",
      priceCents: 1250,
      inventoryCount: 3,
    });

    for (const inventoryCount of [-1, 1.5]) {
      await expect(owner.as.mutation(api.variants.addExplicit, {
        productId,
        title: `Variant ${inventoryCount}`,
        optionValues: [],
        inventoryCount,
      })).rejects.toThrow();
    }

    const [product] = await owner.as.query(api.products.listWithReadiness, { projectId });
    expect(product.status).toBe("active");
    expect(product.source).toBe("mosai_native");
    expect(product.syncState).toBeUndefined();
    expect(product.variants[0].availability).toBe("in_stock");
  });

  it("marks a missing variant as blocked readiness even when a product is active", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Shop" });
    await t.run((ctx) => ctx.db.insert("products", {
      projectId,
      title: "Legacy item without variant",
      status: "active",
      source: "mosai_native",
      authority: "mosai",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    const [product] = await owner.as.query(api.products.listWithReadiness, { projectId });
    expect(product.status).toBe("active");
    expect(product.readiness.state).toBe("blocked");
    expect(product.readiness.issues).toContainEqual(expect.objectContaining({
      field: "variant",
      severity: "error",
    }));
  });
});
