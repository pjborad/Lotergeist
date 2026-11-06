/** Wire types shared with the web app. Keep this file dependency-free: apps/web/src/lib/types.ts is a copy. */

export type RecallStatus = "summoned" | "autopsied" | "confirmed" | "tracing" | "exhuming" | "ready" | "error";
export type RecallClass = "I" | "II" | "III" | "?";

export interface RecallSummary {
  id: string;
  recallNumber: string;
  classification: RecallClass;
  productShort: string;
  status: RecallStatus;
  demo: boolean;
}

export interface Segment { t: string; hit: boolean }

export interface LotView {
  value: string;
  expiry: string;
  confidence: number;
  source: "regex" | "llm" | "both";
  confirmed: boolean;
  ndc: string;
  /** below 0.8: needs a living witness (COR-4) */
  needsWitness: boolean;
  serials: number | null;
}

export interface RecallStats {
  lots: number;
  packages: number | null;
  patients: number | null;
  seconds: number | null;
}

export interface RecallDetail {
  id: string;
  recallNumber: string;
  classification: RecallClass;
  status: RecallStatus;
  product: string;
  firm: string;
  reason: string;
  reportDate: string;
  codeInfo: string;
  segments: Segment[];
  lots: LotView[];
  ndcs: { value: string; confidence: number; source: string }[];
  warnings: string[];
  notes: string;
  needsReview: boolean;
  passes: { regex: boolean; llm: boolean; reconciled: boolean };
  llmProvider: string | null;
  cached: boolean;
  coldChain: boolean;
  stats: RecallStats;
  error?: string;
}

export interface StageCard {
  key: "commissioning" | "shipping" | "receiving" | "dispensing" | "shelf";
  label: string;
  who: string;
  where: string;
  source: "EPCIS" | "RPA" | "LIVE";
  when: string;
  countLabel: string;
  hot: boolean;
}

export interface DispenseView {
  rx: string;
  patientId: string;
  lot: string;
  serial: string;
  serialInferred: boolean;
  fillDate: string;
  source: "rxterm" | "fax";
  pharmacy: string;
  confidence: number;
  eventWritten: boolean;
}

export interface RpaStepView {
  seq: number;
  pharmacyName: string;
  system: "rxterm" | "fax";
  action: string;
  message: string;
  screen?: string;
  rowsFound?: number;
  confidence?: number;
  ts: number;
}

export interface TraceView {
  recallId: string;
  lotLabel: string;
  serials: number;
  orphans: number;
  inPatientHands: number;
  held: number;
  stages: StageCard[];
  pharmacies: { gln: string; name: string; system: "rxterm" | "fax"; received: number; onShelf: number; dispensed: number }[];
  dispenses: DispenseView[];
  steps: RpaStepView[];
  traced: boolean;
  exhumed: boolean;
}

export interface QuarantineBin { id: string; pharmacyGln: string; pharmacyName: string; count: number }

export interface OutreachView {
  id: number;
  recallId: string;
  patientId: string;
  fillDate: string;
  text: string;
  grade: number;
  writtenBy: "template" | "llm" | "pharmacist";
  status: "draft" | "approved";
  approvedBy: string | null;
}

export interface ShortageView {
  genericName: string;
  onList: boolean;
  soleSource: boolean;
  source: string;
  substitute: string | null;
  nadacDelta: number | null;
  unit: string | null;
  note: string | null;
}

export interface AfterlifeView {
  recallIds: string[];
  bins: QuarantineBin[];
  total: number;
  outreach: OutreachView[];
  shortage: ShortageView | null;
}

export interface HearseStopView {
  id: string;
  name: string;
  load: string;
  eta: string;
  cold: boolean;
  held: string;
  tempC: number;
  tempFlag: "ok" | "hot" | "freezing";
  lat: number;
  lon: number;
}

export interface HearseView {
  recallIds: string[];
  avoidHeat: boolean;
  depot: { name: string; lat: number; lon: number };
  stops: HearseStopView[];
  geometry: [number, number][];
  distanceKm: number;
  durationMin: number;
  hazardExposureMin: number;
  avoided: boolean;
  unavoidable: boolean;
  hazards: { id: string; label: string; kind: string; lat: number; lon: number; radiusKm: number; tempF: number; fromHour: number; toHour: number }[];
  warnings: { kind: string; stopId?: string; message: string }[];
  weatherSource: string;
  router: string;
  departs: string;
  summary: string;
  /** minutes added by taking the long way around, when avoided */
  detourMin: number | null;
}

export interface ScanResult {
  verdict: "CURSED" | "CLEAN";
  known: boolean;
  recallId: string | null;
  recallNumber: string | null;
  message: string;
  ais: { ai: string; name: string; value: string; hot: boolean }[];
  raw: string;
  trail: { date: string; text: string }[];
  location: { pharmacy: string; shelf: string } | null;
  bin: string | null;
  checked: { recalls: number; shortages: number; ndc: string; syncedMinutesAgo: number | null };
  decodedMs: number;
}

export interface DemoPackage { label: string; cursed: boolean; element: string; raw: string; shelf: string }

export type PipelineEventType =
  | "recall.summoned" | "recall.autopsied" | "recall.confirmed" | "trace.found" | "rpa.step"
  | "dispense.found" | "undertaker.ready" | "hearse.planned" | "recall.error"
  | "fill.scanned" | "fill.step" | "fill.writeback";

export interface PipelineEvent<T = unknown> {
  id: number;
  type: PipelineEventType;
  recallId: string;
  ts: number;
  data: T;
}

// ---------------------------------------------------------------- Soul Catcher (scan at fill)

export type FillVerdict = "CAPTURED" | "WRONG_VESSEL" | "CURSED" | "DEPARTED";
export type WritebackStatus = "none" | "pending" | "running" | "verified" | "failed";

export interface FillItem {
  rx: string;
  patientId: string;
  drug: string;
  ndc: string;
  qty: number;
  pharmacy: string;
  status: "waiting" | "filled";
  lastVerdict: FillVerdict | null;
}

export interface FillFlag { verdict: FillVerdict; message: string }

export interface FillScanResult {
  id: number;
  rx: string;
  verdict: FillVerdict;
  fillAllowed: boolean;
  message: string;
  flags: FillFlag[];
  drug: string;
  drugSource: "openfda" | "catalog" | "unknown";
  labeler: string | null;
  ndc: string;
  gtin: string;
  lot: string;
  expiry: string;
  serial: string;
  device: "webcam" | "usb" | "typed";
  recallId: string | null;
  recallNumber: string | null;
  expected: { drug: string; ndc: string };
  scannedAt: number;
  savedMs: number;
  writeback: WritebackStatus;
  note: string | null;
}

export interface FillStepView { scanId: number; rx: string; action: string; message: string; screen?: string }
