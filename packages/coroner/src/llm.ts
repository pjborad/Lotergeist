import { z } from "zod";
import fs from "node:fs";
import type { LlmClient } from "./types";

export const DEFAULT_PROMPT = `You are the Coroner, a careful clerk who reads FDA drug recall notices.
You are given the raw recall text and the result of a deterministic regex pass.
Return ONLY a JSON object, no prose, with this shape:
{"ndcs": string[], "lots": [{"value": string, "expiry": string | null, "confidence": number}], "notes": string}
Rules:
1. Every lot "value" MUST be copied character for character from the recall text. Never invent, fix, or reformat a lot.
2. If you are unsure a token is a lot number, leave it out or give confidence below 0.8.
3. "expiry" is an ISO date (YYYY-MM-DD, or YYYY-MM if only month and year are printed). Use null when the text prints none.
4. "confidence" is 0 to 1. Use at least 0.9 only when the text labels the token as a lot or batch.
5. "ndcs" are National Drug Codes exactly as written (digits and hyphens).
6. Put anything odd (ranges, missing expiry, multiple products) in "notes", one short sentence.`;

export function loadPrompt(path?: string): string {
  if (path && fs.existsSync(path)) {
    const raw = fs.readFileSync(path, "utf8");
    const m = /```(?:text|prompt)?\n([\s\S]*?)```/.exec(raw);
    if (m && m[1]!.trim().length > 40) return m[1]!.trim();
  }
  return DEFAULT_PROMPT;
}

export const LlmOutputSchema = z.object({
  ndcs: z.array(z.string()).default([]),
  lots: z.array(z.object({
    value: z.string().min(1),
    expiry: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1)
  })).default([]),
  notes: z.string().default("")
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;

export function parseLlmJson(raw: string): LlmOutput | null {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  try {
    const parsed = LlmOutputSchema.safeParse(JSON.parse(cleaned.slice(first, last + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export class AnthropicClient implements LlmClient {
  readonly name = "anthropic";
  constructor(private apiKey: string, private model: string) {}
  async complete(system: string, user: string): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: 1024, temperature: 0, system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const j = (await res.json()) as { content?: { type: string; text?: string }[] };
    return (j.content ?? []).map((c) => c.text ?? "").join("");
  }
}

export class BedrockClient implements LlmClient {
  readonly name = "bedrock";
  constructor(private region: string, private modelId: string) {}
  async complete(system: string, user: string): Promise<string> {
    const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
    const client = new BedrockRuntimeClient({ region: this.region });
    const out = await client.send(new ConverseCommand({
      modelId: this.modelId,
      system: [{ text: system }],
      messages: [{ role: "user", content: [{ text: user }] }],
      inferenceConfig: { temperature: 0, maxTokens: 1024 }
    }), { abortSignal: AbortSignal.timeout(30_000) });
    return (out.output?.message?.content ?? []).map((c) => ("text" in c ? c.text : "") ?? "").join("");
  }
}

/** Pick an LLM from the environment; null means regex-only mode. */
export function createLlmFromEnv(env: Record<string, string | undefined> = process.env): LlmClient | null {
  const provider = (env.LLM_PROVIDER ?? "").toLowerCase();
  if (provider === "none") return null;
  if (provider === "bedrock" || (!provider && (env.AWS_ACCESS_KEY_ID || env.AWS_PROFILE) && env.BEDROCK_MODEL_ID)) {
    return new BedrockClient(env.AWS_REGION ?? "us-west-2", env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-5-haiku-20241022-v1:0");
  }
  if (provider === "anthropic" || (!provider && env.ANTHROPIC_API_KEY)) {
    if (!env.ANTHROPIC_API_KEY) return null;
    return new AnthropicClient(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest");
  }
  return null;
}
