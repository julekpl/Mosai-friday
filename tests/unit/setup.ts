import { beforeEach, afterEach, vi } from "vitest";
import { openRouterFetch } from "./stubs/vly-integrations";

const nativeFetch = globalThis.fetch;
const openRouterEnvName = ["OPENROUTER", "API", "KEY"].join("_");
const originalOpenRouterApiKey = process.env[openRouterEnvName];

beforeEach(() => {
  process.env[openRouterEnvName] = "test";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "openrouter.ai") return openRouterFetch(input, init);
    return nativeFetch(input, init);
  });
});

afterEach(() => {
  if (originalOpenRouterApiKey === undefined) delete process.env[openRouterEnvName];
  else process.env[openRouterEnvName] = originalOpenRouterApiKey;
});
