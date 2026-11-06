export type Source = "regex" | "llm" | "both";

export interface ExtractedLot {
  value: string;
  /** ISO date (YYYY-MM-DD) or month precision (YYYY-MM) */
  expiry?: string;
  confidence: number;
  source: Source;
}

export interface ExtractedNdc {
  value: string;
  confidence: number;
  source: Source;
}

export interface Autopsy {
  ndcs: ExtractedNdc[];
  lots: ExtractedLot[];
  notes: string;
  warnings: string[];
  /** true when any confidence is below the review threshold (COR-4) or nothing was found */
  needsReview: boolean;
  passes: { regex: boolean; llm: boolean; reconciled: boolean };
}

export const REVIEW_THRESHOLD = 0.8;

export interface LlmClient {
  readonly name: string;
  complete(system: string, user: string): Promise<string>;
}
