import { extractRegex } from "./regex-pass";
import { LlmOutput, loadPrompt, parseLlmJson } from "./llm";
import { reconcile } from "./reconcile";
import type { Autopsy, LlmClient } from "./types";

export * from "./types";
export * from "./dates";
export * from "./regex-pass";
export * from "./llm";
export * from "./reconcile";

export interface AutopsyOptions {
  llm?: LlmClient | null;
  promptPath?: string;
}

/**
 * Coroner entry point. COR-2: regex runs first, the LLM second.
 * COR-5: invalid LLM output is retried once, then we fall back to regex-only.
 */
export async function autopsy(sourceText: string, opts: AutopsyOptions = {}): Promise<Autopsy> {
  const regex = extractRegex(sourceText);
  let llmOut: LlmOutput | null = null;
  let llmNote = "";

  if (opts.llm) {
    const system = loadPrompt(opts.promptPath);
    const user = JSON.stringify({ recall_text: sourceText, regex_result: regex });
    for (let attempt = 0; attempt < 2 && !llmOut; attempt++) {
      try {
        llmOut = parseLlmJson(await opts.llm.complete(system, user));
      } catch (e) {
        llmNote = `LLM call failed (${(e as Error).message}).`;
      }
    }
    if (!llmOut && !llmNote) llmNote = "LLM output failed schema validation twice.";
  }

  const result = reconcile(sourceText, regex, llmOut);
  if (opts.llm && !llmOut) result.warnings.push(`${llmNote} Fell back to regex-only.`);
  return result;
}
