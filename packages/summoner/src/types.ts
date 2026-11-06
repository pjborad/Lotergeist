export interface RecallRecord {
  recall_number: string;
  classification: string;
  status: string;
  product_description: string;
  code_info: string;
  reason_for_recall: string;
  recalling_firm: string;
  report_date: string;
  /** Raw openFDA JSON, stored untouched for audit */
  raw: unknown;
  /** True when served from the fixture set instead of the live API */
  cached?: boolean;
}

export type PasteKind =
  | { kind: "number"; recallNumber: string }
  | { kind: "text"; text: string };
