import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Tables for the market blueprint lane (owner decision 26 Sep 2026: build all
 * four blueprints in waves). Spread into `schema.ts`; every table here must
 * also be registered in `lib/dataRegistry.ts` (look for the market marker).
 */
export const marketTables = {
  // e.g. exampleTable: defineTable({ projectId: v.id("projects") }).index("by_project", ["projectId"]),
};

// Keep the imports used until the lane adds its first table.
void defineTable;
void v;
