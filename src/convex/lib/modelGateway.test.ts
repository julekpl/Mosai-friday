import { afterEach, describe, expect, it, vi } from "vitest";
import { completeText } from "./modelGateway";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("completeText", () => {
  it("routes chat completions through Hugging Face without putting the token in the body", async () => {
    vi.stubEnv("AI_PROVIDER", "huggingface");
    vi.stubEnv("HF_TOKEN", "test-secret");
    vi.stubEnv("HF_CHAT_MODEL", "openai/gpt-oss-120b:cheapest");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "  result  " } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const text = await completeText({
      messages: [{ role: "user", content: "Hello" }],
      maxTokens: 100,
    });

    expect(text).toBe("result");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://router.huggingface.co/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer test-secret",
    );
    expect(String(init.body)).not.toContain("test-secret");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "openai/gpt-oss-120b:cheapest",
      max_tokens: 100,
      stream: false,
    });
  });

  it("fails closed for an unsupported provider", async () => {
    vi.stubEnv("AI_PROVIDER", "unknown");
    await expect(
      completeText({ messages: [{ role: "user", content: "Hello" }] }),
    ).rejects.toThrow("Unsupported AI_PROVIDER");
  });
});
