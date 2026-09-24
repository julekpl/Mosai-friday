import schema from "../src/convex/schema.ts";
import { DATA_REGISTRY } from "../src/convex/lib/dataRegistry.ts";
import { validateDataRegistry } from "./data-registry-audit.mjs";

const errors = validateDataRegistry(schema.tables, DATA_REGISTRY);
if (errors.length) {
  console.error(`Data registry audit failed (${errors.length}):\n${errors.map((error) => `- ${error}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Data registry audit passed: ${Object.keys(schema.tables).length} schema tables are registered.`);
}
