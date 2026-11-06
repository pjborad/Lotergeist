import { gtinCheckDigit, ndc10ToGtin14, ndc10ToNdc11, sgtinDigitalLink } from "@bsrx/gs1";
import type { EpcisEvent, Party } from "@bsrx/tracker";
import { rng, type Rng } from "./rng";

export interface Product {
  ndc10: string;
  ndc11: string;
  gtin: string;
  name: string;
  manufacturerGln: string;
  distributorGln: string;
  refrigerated: boolean;
  /** true for drugs that exist in the real world (looked up live in openFDA); everything else is synthetic */
  real?: boolean;
}

export interface Allocation { pharmacyGln: string; count: number; shelf: string }

export interface LotPlan {
  product: Product;
  lot: string;
  /** ISO date, or "" when the label prints no expiry */
  expiry: string;
  firstSerial: number;
  count: number;
  commissionDate: string;
  shipToDistDate: string;
  recvDistDate: string;
  shipToPharmDate: string;
  recvPharmDate: string;
  /** ascending serial ranges; empty means the lot never left the distributor */
  alloc: Allocation[];
}

export interface Fill {
  rx: string;
  patientId: string;
  pharmacyGln: string;
  system: "rxterm" | "fax";
  ndc10: string;
  ndc11: string;
  productName: string;
  lot: string;
  qty: number;
  fillDate: string;
  /** ground truth, which a real terminal would not show */
  serials: string[];
}

/** A prescription waiting to be filled at a pharmacy (the RxTerm 98 FILL QUEUE). */
export interface QueueItem {
  rx: string;
  patientId: string;
  pharmacyGln: string;
  ndc10: string;
  ndc11: string;
  drug: string;
  qty: number;
}

export interface World {
  seed: number;
  queue: QueueItem[];
  parties: Party[];
  depot: Party;
  products: Product[];
  lots: LotPlan[];
  fills: Fill[];
  serialCount: number;
  events(): Generator<EpcisEvent>;
  eventCount: number;
}

export interface GenerateOptions {
  seed?: number;
  /** serials per filler lot; the default gives about 40,000 packages overall */
  fillerSerialsPerLot?: number;
  patients?: number;
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const serialStr = (n: number) => pad(n, 6);

function mkGln(idx: number): string {
  const body = `0614141${pad(idx, 5)}`;
  return body + gtinCheckDigit(body);
}

// Map the design's 800x520 map canvas to lat/lon so the hearse screen matches the mock.
const LAT0 = 45.5152, LON0 = -122.6784, DEG_PER_PX = 0.00023;
export const xyToLatLon = (x: number, y: number) => ({
  lat: +(LAT0 - (y - 260) * DEG_PER_PX).toFixed(5),
  lon: +(LON0 + ((x - 400) * DEG_PER_PX) / Math.cos((LAT0 * Math.PI) / 180)).toFixed(5)
});

const DEMO_PHARMACIES = [
  { id: "A", name: "Branch 7 · Elm St", system: "fax" as const, code: "", xy: [230, 330] },
  { id: "B", name: "Riverside Apothecary", system: "rxterm" as const, code: "RIV02", xy: [360, 170] },
  { id: "C", name: "North Hill Pharmacy", system: "rxterm" as const, code: "NHP03", xy: [520, 100] },
  { id: "D", name: "Lantern Lane Rx", system: "rxterm" as const, code: "LLR04", xy: [650, 330] },
  { id: "E", name: "Old Mill Clinic", system: "rxterm" as const, code: "OMC05", xy: [460, 430] },
  { id: "F", name: "Harbor Street Drug", system: "rxterm" as const, code: "HSD06", xy: [180, 150] },
  { id: "G", name: "Quarry Road Pharmacy", system: "rxterm" as const, code: "QRP07", xy: [720, 450] },
  { id: "H", name: "Tollgate Apothecary", system: "rxterm" as const, code: "TGA08", xy: [300, 480] }
];

const FILLERS: { ndc10: string; name: string }[] = [
  { ndc10: "65162-123-10", name: "Amoxicillin 500 mg capsules" },
  { ndc10: "0093-4068-01", name: "Lisinopril 10 mg tablets" },
  { ndc10: "68180-0987-1", name: "Metformin 500 mg tablets" },
  { ndc10: "50111-456-01", name: "Atorvastatin 20 mg tablets" },
  { ndc10: "0781-2802-31", name: "Omeprazole 20 mg capsules" },
  { ndc10: "16729-276-10", name: "Sertraline 50 mg tablets" },
  { ndc10: "60687-345-01", name: "Levothyroxine 50 mcg tablets" },
  { ndc10: "59310-579-20", name: "Albuterol HFA inhaler" },
  { ndc10: "0555-0766-02", name: "Prednisone 10 mg tablets" }
];

const FIXED_LOT1: Record<string, { rx: string; patient: string; date: string }[]> = {
  B: [
    { rx: "0071834", patient: "S-0417", date: "2025-10-09" }, { rx: "0071851", patient: "S-0423", date: "2025-10-09" },
    { rx: "0071902", patient: "S-0448", date: "2025-10-10" }, { rx: "0071937", patient: "S-0461", date: "2025-10-13" },
    { rx: "0071988", patient: "S-0490", date: "2025-10-15" }, { rx: "0072010", patient: "S-0371", date: "2025-10-17" },
    { rx: "0072044", patient: "S-0388", date: "2025-10-21" }
  ],
  C: [
    { rx: "0081120", patient: "S-0612", date: "2025-10-11" }, { rx: "0081133", patient: "S-0640", date: "2025-10-12" },
    { rx: "0081207", patient: "S-0655", date: "2025-10-16" }, { rx: "0081301", patient: "S-0671", date: "2025-10-18" }
  ],
  D: [{ rx: "0093405", patient: "S-0702", date: "2025-10-14" }, { rx: "0093466", patient: "S-0719", date: "2025-10-20" }],
  E: [{ rx: "0012377", patient: "S-0803", date: "2025-10-19" }],
  A: [
    { rx: "88123", patient: "S-0502", date: "2025-10-11" }, { rx: "88140", patient: "S-0519", date: "2025-10-12" },
    { rx: "88177", patient: "S-0533", date: "2025-10-14" }
  ]
};

export function generateWorld(opts: GenerateOptions = {}): World {
  const seed = opts.seed ?? 1998;
  const r: Rng = rng(seed);
  const patients = opts.patients ?? 2400;
  const fillerSerials = opts.fillerSerialsPerLot ?? 2150;

  // ---- parties ----
  const mfr = [
    { gln: mkGln(1), name: "Hollow Creek Compounding (synthetic)", kind: "manufacturer" as const },
    { gln: mkGln(2), name: "Marrowfield Labs (synthetic)", kind: "manufacturer" as const },
    { gln: mkGln(3), name: "Nightjar Biologics (synthetic)", kind: "manufacturer" as const },
    { gln: mkGln(4), name: "Pale Harbor Pharma (synthetic)", kind: "manufacturer" as const }
  ];
  const dist = [
    { gln: mkGln(11), name: "Ashgrove Distribution · DC East", kind: "distributor" as const },
    { gln: mkGln(12), name: "Brackwater Wholesale", kind: "distributor" as const }
  ];
  const pharm: Party[] = DEMO_PHARMACIES.map((p, i) => ({
    gln: mkGln(21 + i), name: p.name, kind: "pharmacy" as const, system: p.system, code: p.code || undefined,
    ...xyToLatLon(p.xy[0]!, p.xy[1]!)
  }));
  const depot: Party = { gln: mkGln(31), name: "The Crypt · returns depot", kind: "depot", ...xyToLatLon(90, 440) };
  const parties: Party[] = [...mfr, ...dist, ...pharm, depot];
  const P = (letter: string) => pharm[DEMO_PHARMACIES.findIndex((p) => p.id === letter)]!;

  // ---- products ----
  const mk = (ndc10: string, name: string, m: string, d: string, refrigerated = false): Product => ({
    ndc10, ndc11: ndc10ToNdc11(ndc10), gtin: ndc10ToGtin14(ndc10), name, manufacturerGln: m, distributorGln: d, refrigerated
  });
  const methyl = mk("70004-417-05", "Methylprednisolone Acetate Injectable Suspension, 40 mg/mL, 5 mL vial", mfr[0]!.gln, dist[0]!.gln);
  const ondans = mk("70004-088-12", "Ondansetron Orally Disintegrating Tablets, 4 mg, 30-count bottle", mfr[1]!.gln, dist[0]!.gln);
  const insulin = mk("70004-623-15", "Insulin Glargine 100 units/mL, 5 x 3 mL prefilled pens", mfr[2]!.gln, dist[0]!.gln, true);
  const fillers = FILLERS.map((f, i) => mk(f.ndc10, f.name, mfr[3]!.gln, dist[i % 2]!.gln));
  // Real drug from real recall D-0526-2026 (Hikma alendronate oral solution). No synthetic lots exist for it:
  // it is here so the Soul Catcher can name it and the catalog fallback works offline.
  const alendronate = { ...mk("0054-0282-59", "Alendronate Sodium Oral Solution, 70 mg/75 mL, 75 mL single-dose bottle", mfr[3]!.gln, dist[0]!.gln), real: true };
  const products = [methyl, ondans, insulin, alendronate, ...fillers];

  // ---- lot plans ----
  const lots: LotPlan[] = [];
  const plan = (product: Product, lot: string, expiry: string, firstSerial: number, count: number, dates: [string, string, string, string, string], alloc: Allocation[]) =>
    lots.push({ product, lot, expiry, firstSerial, count, commissionDate: dates[0], shipToDistDate: dates[1], recvDistDate: dates[2], shipToPharmDate: dates[3], recvPharmDate: dates[4], alloc });
  const al = (letter: string, count: number, shelf: string): Allocation => ({ pharmacyGln: P(letter).gln, count, shelf });
  const D1: [string, string, string, string, string] = ["2025-09-25", "2025-09-27", "2025-09-30", "2025-10-02", "2025-10-04"];

  // The design's recalled lots. Received per pharmacy = still on the shelf + dispensed.
  plan(methyl, "PRORX050925-1", "2025-11-04", 1, 214, D1, [al("E", 28, "C-12"), al("D", 31, "C-12"), al("C", 65, "C-12"), al("B", 45, "C-12"), al("A", 45, "C-12")]);
  plan(methyl, "PRORX050925-3", "2025-11-06", 215, 198, D1, []); // still at the distributor
  plan(methyl, "PRORX051125-2", "2025-12-08", 413, 300, D1, [al("E", 50, "C-13"), al("D", 50, "C-13"), al("A", 60, "C-13"), al("B", 70, "C-13"), al("C", 70, "C-13")]);
  plan(ondans, "224010", "", 1, 96, ["2025-08-12", "2025-08-14", "2025-08-18", "2025-10-01", "2025-10-03"], [al("E", 30, "B-04"), al("B", 36, "B-04"), al("A", 30, "B-04")]);
  plan(ondans, "224011", "", 97, 88, ["2025-08-12", "2025-08-14", "2025-08-18", "2025-10-01", "2025-10-03"], [al("E", 28, "B-05"), al("B", 30, "B-05"), al("A", 30, "B-05")]);
  plan(insulin, "GX4471A", "2027-03-31", 1, 240, ["2025-06-02", "2025-06-04", "2025-06-09", "2025-10-05", "2025-10-06"], [al("D", 110, "R-01"), al("C", 130, "R-01")]);
  plan(insulin, "GX4471B", "2027-03-31", 241, 231, ["2025-06-02", "2025-06-04", "2025-06-09", "2025-10-05", "2025-10-06"], [al("D", 111, "R-02"), al("C", 120, "R-02")]);

  const phAll = DEMO_PHARMACIES.map((_, i) => pharm[i]!);
  fillers.forEach((p, i) => {
    for (const k of [1, 2]) {
      const total = fillerSerials;
      const weights = phAll.map(() => 1 + r.next());
      const sum = weights.reduce((a, b) => a + b, 0);
      let left = total;
      const alloc: Allocation[] = phAll.map((ph, j) => {
        const c = j === phAll.length - 1 ? left : Math.floor((weights[j]! / sum) * total);
        left -= c;
        return { pharmacyGln: ph.gln, count: c, shelf: `${String.fromCharCode(65 + (i % 8))}-${pad(r.int(1, 30), 2)}` };
      });
      plan(p, `FL${pad(i + 1, 2)}${pad(r.int(100, 999), 3)}${k}`, `2026-${pad(r.int(1, 12), 2)}-28`, (k - 1) * total + 1, total,
        ["2025-08-20", "2025-08-22", "2025-08-26", "2025-09-24", "2025-09-26"], alloc);
    }
  });

  // ---- fills (what the pharmacies' own systems know) ----
  const fills: Fill[] = [];
  const usedRx = new Set<string>();
  const nextRx = new Map<string, number>();
  const rxFor = (letter: string) => {
    const base: Record<string, number> = { A: 88200, B: 72100, C: 81400, D: 93500, E: 12400, F: 55100, G: 66100, H: 77100 };
    for (;;) {
      const n = (nextRx.get(letter) ?? base[letter]!) + r.int(3, 40);
      nextRx.set(letter, n);
      const rx = P(letter).system === "fax" ? String(n) : pad(n, 7);
      if (!usedRx.has(letter + rx)) { usedRx.add(letter + rx); return rx; }
    }
  };
  const patientId = () => `S-${pad(r.int(1, patients), 4)}`;
  const date = (lo: number, hi: number) => `2025-10-${pad(r.int(lo, hi), 2)}`;
  const addFill = (letter: string, lotPlan: LotPlan, rx: string, patient: string, fillDate: string) => {
    fills.push({
      rx, patientId: patient, pharmacyGln: P(letter).gln, system: P(letter).system!, ndc10: lotPlan.product.ndc10, ndc11: lotPlan.product.ndc11,
      productName: lotPlan.product.name, lot: lotPlan.lot, qty: 1, fillDate, serials: []
    });
    usedRx.add(letter + rx);
  };
  const byLot = (lot: string) => lots.find((l) => l.lot === lot)!;

  for (const [letter, rows] of Object.entries(FIXED_LOT1)) for (const x of rows) addFill(letter, byLot("PRORX050925-1"), x.rx, x.patient, x.date);
  const spread = (lot: string, per: Record<string, number>, lo = 9, hi = 28) => {
    for (const [letter, n] of Object.entries(per)) for (let i = 0; i < n; i++) addFill(letter, byLot(lot), rxFor(letter), patientId(), date(lo, hi));
  };
  spread("224010", { A: 1, B: 2, E: 1 });
  spread("224011", { A: 1, B: 2, E: 2 });
  spread("GX4471A", { C: 7, D: 6 });
  spread("GX4471B", { C: 5, D: 5 });
  spread("PRORX051125-2", { A: 3, B: 4, C: 4, D: 3, E: 3 }, 8, 30);
  fillers.forEach((p) => {
    const lp = lots.find((l) => l.product === p)!;
    for (const ph of phAll) {
      const letter = DEMO_PHARMACIES[phAll.indexOf(ph)]!.id;
      if (letter === "A") continue; // the fax-only pharmacy only sends recall-related logs
      const stock = lp.alloc.find((a) => a.pharmacyGln === ph.gln)?.count ?? 0;
      const n = Math.min(r.int(5, 9), Math.floor(stock / 2)); // found by PBT: tiny worlds ran out of stock
      for (let i = 0; i < n; i++) addFill(letter, lp, rxFor(letter), patientId(), date(8, 30));
    }
  });

  // ---- assign ground-truth serials FIFO per pharmacy + lot ----
  const groups = new Map<string, Fill[]>();
  for (const f of fills) {
    const k = `${f.pharmacyGln}|${f.lot}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
  }
  for (const [k, gf] of groups) {
    const [gln, lot] = k.split("|") as [string, string];
    const lp = byLot(lot);
    let cursor = lp.firstSerial;
    let range: [number, number] | null = null;
    for (const a of lp.alloc) {
      if (a.pharmacyGln === gln) { range = [cursor, cursor + a.count - 1]; break; }
      cursor += a.count;
    }
    if (!range) throw new Error(`fill for ${lot} at a pharmacy that never received it`);
    let next = range[0];
    gf.sort((a, b) => a.fillDate.localeCompare(b.fillDate) || a.rx.localeCompare(b.rx));
    for (const f of gf) {
      for (let q = 0; q < f.qty; q++) {
        if (next > range[1]) throw new Error(`out of stock for ${lot} at ${gln}`);
        f.serials.push(serialStr(next++));
      }
    }
  }
  fills.sort((a, b) => a.fillDate.localeCompare(b.fillDate) || a.rx.localeCompare(b.rx));

  // ---- fill queue at Riverside Apothecary (RIV02): prescriptions waiting for the Soul Catcher ----
  const mkQ = (rx: string, patientId: string, p: Product, drug: string): QueueItem => ({ rx, patientId, pharmacyGln: P("B").gln, ndc10: p.ndc10, ndc11: p.ndc11, drug, qty: 1 });
  const queue: QueueItem[] = [
    mkQ("0099101", "S-0910", methyl, "Methylprednisolone Acetate 40 mg/mL, 5 mL vial"),
    mkQ("0099102", "S-0911", methyl, "Methylprednisolone Acetate 40 mg/mL, 5 mL vial"),
    mkQ("0099103", "S-0912", ondans, "Ondansetron ODT 4 mg, 30 ct"),
    mkQ("0099104", "S-0913", alendronate, "Alendronate Sodium Oral Solution 70 mg/75 mL"),
    mkQ("0099105", "S-0914", methyl, "Methylprednisolone Acetate 40 mg/mL, 5 mL vial")
  ];

  // ---- events (generated lazily; about 5 per serial) ----
  const serialCount = lots.reduce((a, l) => a + l.count, 0);
  const eventCount = lots.reduce((a, l) => a + l.count * (3 + (l.alloc.length ? 2 : 0)), 0);
  const stamp = (d: string, hour: number, i: number) => {
    const s = hour * 3600 + i;
    return `${d}T${pad(Math.floor(s / 3600) % 24, 2)}:${pad(Math.floor(s / 60) % 60, 2)}:${pad(s % 60, 2)}Z`;
  };
  function* events(): Generator<EpcisEvent> {
    for (const lp of lots) {
      const p = lp.product;
      const bounds: { gln: string; shelf: string; endSerial: number }[] = [];
      let c = lp.firstSerial;
      for (const a of lp.alloc) { c += a.count; bounds.push({ gln: a.pharmacyGln, shelf: a.shelf, endSerial: c - 1 }); }
      for (let i = 0; i < lp.count; i++) {
        const n = lp.firstSerial + i;
        const serial = serialStr(n);
        const base = { type: "ObjectEvent" as const, epc: sgtinDigitalLink(p.gtin, serial), gtin: p.gtin, serial, lot: lp.lot, expiry: lp.expiry, origin: "epcis" as const, meta: "{}" };
        const id = (s: string) => `urn:uuid:${s}-${p.gtin}-${serial}`;
        yield { ...base, eventId: id("com"), bizStep: "commissioning", eventTime: stamp(lp.commissionDate, 8, i), readPoint: p.manufacturerGln, bizLocation: "Line 3", ownerGln: p.manufacturerGln, sourceGln: "", destGln: "" };
        yield { ...base, eventId: id("shp1"), bizStep: "shipping", eventTime: stamp(lp.shipToDistDate, 9, i), readPoint: p.manufacturerGln, bizLocation: "", ownerGln: p.manufacturerGln, sourceGln: p.manufacturerGln, destGln: p.distributorGln };
        yield { ...base, eventId: id("rcv1"), bizStep: "receiving", eventTime: stamp(lp.recvDistDate, 10, i), readPoint: p.distributorGln, bizLocation: "DC East", ownerGln: p.distributorGln, sourceGln: p.manufacturerGln, destGln: "" };
        const dest = bounds.find((b) => n <= b.endSerial);
        if (!dest) continue;
        yield { ...base, eventId: id("shp2"), bizStep: "shipping", eventTime: stamp(lp.shipToPharmDate, 9, i), readPoint: p.distributorGln, bizLocation: "", ownerGln: p.distributorGln, sourceGln: p.distributorGln, destGln: dest.gln };
        yield { ...base, eventId: id("rcv2"), bizStep: "receiving", eventTime: stamp(lp.recvPharmDate, 11, i), readPoint: dest.gln, bizLocation: dest.shelf, ownerGln: dest.gln, sourceGln: p.distributorGln, destGln: "" };
      }
    }
  }

  return { seed, queue, parties, depot, products, lots, fills, serialCount, events, eventCount };
}
