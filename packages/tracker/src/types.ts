export type PartyKind = "manufacturer" | "distributor" | "pharmacy" | "depot";
export type BizStep = "commissioning" | "shipping" | "receiving" | "dispensing";

export interface Party {
  gln: string;
  name: string;
  kind: PartyKind;
  lat?: number;
  lon?: number;
  /** how the pharmacy keeps its dispense records */
  system?: "rxterm" | "fax";
  /** RxTerm 98 login for the pharmacy */
  code?: string;
  address?: string;
}

/** Flattened EPCIS 2.0 ObjectEvent for one serialized package. */
export interface EpcisEvent {
  eventId: string;
  type: "ObjectEvent";
  bizStep: BizStep;
  eventTime: string;
  /** GS1 Digital Link of the SGTIN */
  epc: string;
  gtin: string;
  serial: string;
  lot: string;
  expiry: string;
  readPoint: string;
  bizLocation: string;
  ownerGln: string;
  sourceGln: string;
  destGln: string;
  /** "epcis" for supply-chain events, "rpa" for events written back by the Grave Robber */
  origin: "epcis" | "rpa";
  /** JSON string with extras (rx number, patient id, ...) */
  meta: string;
}

export interface SerialRow {
  gtin: string;
  serial: string;
  lot: string;
  expiry: string;
  currentOwner: string;
  currentLocation: string;
  currentShelf: string;
  lastBizStep: BizStep;
  lastEventTime: string;
}

export interface TraceFilter {
  gtins: string[];
  lots: string[];
}

export interface LotTrace {
  lot: string;
  gtin: string;
  expiry: string;
  serials: number;
  atManufacturer: number;
  atDistributor: number;
  onPharmacyShelf: number;
  dispensed: number;
}

export interface PharmacyTrace {
  gln: string;
  name: string;
  system: "rxterm" | "fax";
  code: string;
  lat: number;
  lon: number;
  received: number;
  onShelf: number;
  dispensed: number;
}

export interface StageTrace {
  bizStep: BizStep | "shelf";
  count: number;
  firstDate: string;
  lastDate: string;
  who: string;
}

export interface TraceResult {
  filter: TraceFilter;
  totalSerials: number;
  orphans: number;
  lots: LotTrace[];
  pharmacies: PharmacyTrace[];
  stages: StageTrace[];
  ms: number;
}

export interface CustodyStep {
  bizStep: BizStep;
  eventTime: string;
  partyName: string;
  location: string;
  shelf: string;
  origin: "epcis" | "rpa";
  meta: Record<string, unknown>;
}
