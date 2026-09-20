import { vly } from "../../lib/vly-integrations";

export type ModelMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompletionOptions = {
  messages: ModelMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
};

type HuggingFaceCompletion = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string } | string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function completeWithHuggingFace(options: CompletionOptions): Promise<string> {
  const token = requiredEnvironment("HF_TOKEN");
  const model =
    options.model?.trim() ||
    process.env.HF_CHAT_MODEL?.trim() ||
    "openai/gpt-oss-120b:fastest";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let response: Response;
  try {
    response = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 900,
        stream: false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const requestId = response.headers.get("x-request-id");
  const payload = (await response.json().catch(() => ({}))) as HuggingFaceCompletion;
  if (!response.ok) {
    const providerMessage =
      typeof payload.error === "string" ? payload.error : payload.error?.message;
    throw new Error(
      `Hugging Face inference failed (${response.status}${requestId ? `, ${requestId}` : ""})${
        providerMessage ? `: ${providerMessage.slice(0, 240)}` : ""
      }`,
    );
  }

  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Hugging Face inference returned an empty response");
  return text;
}

async function completeWithVly(options: CompletionOptions): Promise<string> {
  const result = await vly.ai.completion({
    model: options.model?.trim() || process.env.VLY_CHAT_MODEL?.trim() || "gpt-4o-mini",
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    maxTokens: options.maxTokens ?? 900,
  });
  if (!result.success || !result.data) {
    throw new Error(result.error ?? "AI request failed");
  }
  const text = result.data.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("AI provider returned an empty response");
  return text;
}

/**
 * One server-side boundary for model access. Provider credentials never reach
 * the browser, and product features do not hard-code provider-specific APIs.
 */
export async function completeText(options: CompletionOptions): Promise<string> {
  if (!options.messages.length) throw new Error("AI request has no messages");
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() || "vly";

  if (provider === "huggingface") return await completeWithHuggingFace(options);
  if (provider === "vly") return await completeWithVly(options);
  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}
