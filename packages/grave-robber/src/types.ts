export type RpaAction = "start" | "login" | "navigate" | "search" | "page" | "row" | "fax" | "logout" | "blocked" | "skip" | "writeback" | "verify" | "done" | "error";

export interface RpaStep {
  seq: number;
  pharmacyGln: string;
  pharmacyName: string;
  system: "rxterm" | "fax";
  action: RpaAction;
  message: string;
  /** the terminal screen (innerText) or fax text as the bot saw it */
  screen?: string;
  /** rows parsed so far for this pharmacy */
  rowsFound?: number;
  /** parse confidence 0-1 for fax pages */
  confidence?: number;
  ts: number;
}

/** RPA-2 row schema. */
export interface DispenseRow {
  rxNumber: string;
  patientId: string;
  ndc: string;
  lot: string;
  qty: number;
  /** ISO date */
  fillDate: string;
  source: "rxterm" | "fax";
  pharmacyGln: string;
  pharmacyName: string;
  confidence: number;
}

export interface PharmacyRef {
  gln: string;
  name: string;
  system: "rxterm" | "fax";
  code: string;
}

export interface ExhumeOptions {
  rxtermUrl: string;
  pharmacies: PharmacyRef[];
  /** NDCs as the terminal wants them (11-digit hyphenated) */
  ndcs: string[];
  /** recalled lots: rows with other lots are skipped */
  lots: string[];
  faxDir: string;
  onStep?: (s: RpaStep) => void | Promise<void>;
  password?: string;
  headless?: boolean;
  /** pause between steps so the UI can show them streaming */
  stepDelayMs?: number;
  /** hosts the bot may touch (RPA-5). Defaults to the RxTerm host. */
  allowedHosts?: string[];
  selectorsPath?: string;
}
