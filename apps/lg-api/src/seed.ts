import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config";
import type { Db } from "./db";
import { DAY, gtinOf, hashPassword, monthEnd, ndc11Digits, rng, suggestLocation, type PackageStatus, type Storage } from "./domain";

/**
 * Synthetic seed for Elm Street Pharmacy · Store 7. Everything here is invented (example.com addresses,
 * 555-01xx numbers) except the real drug in the alendronate product used for the live recall demo.
 */

export const DEMO_PASSWORD = "moonlight-rx-2026";

export interface SeedProduct { ndc10: string; name: string; strength: string; form: string; pack: string; maker: string; storage: Storage; reorder: number; source: "synthetic" | "openfda" }

export const PRODUCTS: SeedProduct[] = [
  { ndc10: "70004-417-05", name: "Methylprednisolone acetate 40 mg/mL · 5 mL", strength: "40 mg/mL", form: "injectable suspension", pack: "5 mL vial", maker: "Hollow Creek Pharma", storage: "room", reorder: 20, source: "synthetic" },
  { ndc10: "70004-623-15", name: "Insulin glargine 100 U/mL · 5 pens", strength: "100 units/mL", form: "pen injector", pack: "5 × 3 mL pens", maker: "Nightjar Biologics", storage: "cold", reorder: 10, source: "synthetic" },
  { ndc10: "70004-088-12", name: "Ondansetron ODT 4 mg · 30 ct", strength: "4 mg", form: "orally disintegrating tablet", pack: "30 tablets", maker: "Marrowfield Labs", storage: "room", reorder: 10, source: "synthetic" },
  { ndc10: "70004-226-01", name: "Amoxicillin 500 mg · 100 cap", strength: "500 mg", form: "capsule", pack: "100 capsules", maker: "Marrowfield Labs", storage: "room", reorder: 10, source: "synthetic" },
  { ndc10: "70004-310-10", name: "Oxycodone HCl 5 mg · 100 tab", strength: "5 mg", form: "tablet", pack: "100 tablets", maker: "Hollow Creek Pharma", storage: "c2", reorder: 8, source: "synthetic" },
  { ndc10: "70004-145-90", name: "Amlodipine 5 mg · 90 tab", strength: "5 mg", form: "tablet", pack: "90 tablets", maker: "Marrowfield Labs", storage: "room", reorder: 8, source: "synthetic" },
  { ndc10: "70004-712-01", name: "Semaglutide 1 mg/dose pen", strength: "1 mg/dose", form: "pen injector", pack: "1 pen", maker: "Nightjar Biologics", storage: "cold", reorder: 6, source: "synthetic" },
  { ndc10: "70004-801-90", name: "Lisinopril 10 mg · 90 tab", strength: "10 mg", form: "tablet", pack: "90 tablets", maker: "Pale Harbor Pharma", storage: "room", reorder: 10, source: "synthetic" },
  { ndc10: "70004-802-10", name: "Metformin ER 500 mg · 100 tab", strength: "500 mg", form: "extended-release tablet", pack: "100 tablets", maker: "Pale Harbor Pharma", storage: "room", reorder: 10, source: "synthetic" },
  { ndc10: "70004-803-90", name: "Atorvastatin 20 mg · 90 tab", strength: "20 mg", form: "tablet", pack: "90 tablets", maker: "Pale Harbor Pharma", storage: "room", reorder: 10, source: "synthetic" },
  { ndc10: "70004-804-30", name: "Sertraline 50 mg · 30 tab", strength: "50 mg", form: "tablet", pack: "30 tablets", maker: "Pale Harbor Pharma", storage: "room", reorder: 10, source: "synthetic" },
  { ndc10: "70004-805-01", name: "Albuterol HFA 90 mcg", strength: "90 mcg", form: "inhalation aerosol", pack: "1 inhaler", maker: "Pale Harbor Pharma", storage: "room", reorder: 6, source: "synthetic" },
  // A real drug (real NDC) so the live recall demo can use real recall D-0526-2026 and the camera can read real cartons.
  { ndc10: "0054-0282-59", name: "Alendronate sodium oral solution 70 mg/75 mL", strength: "70 mg/75 mL", form: "oral solution", pack: "4 × 75 mL bottles", maker: "Hikma Pharmaceuticals USA", storage: "room", reorder: 4, source: "openfda" }
];

const byNdc = (ndc10: string) => PRODUCTS.find((p) => p.ndc10 === ndc10)!;

export interface ExpectedPackage { delivery: string; ndc10: string; lot: string; expiry: string; serial: string }

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const serial8 = (lot: string, n: number) => String(10_000_000 + ((lot.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0) % 70_000_000) + n);

/** Packages that arrive with the two open deliveries: used by the seed (as the TI/TS record) and by the label printer. */
export function expectedPackages(): ExpectedPackage[] {
  const out: ExpectedPackage[] = [];
  const add = (delivery: string, ndc10: string, lot: string, expiry: string, serials: string[]) => serials.forEach((serial) => out.push({ delivery, ndc10, lot, expiry, serial }));
  // ASH-1105-07: the last three of 38 packages (the other 35 are already checked in)
  add("ASH-1105-07", "70004-226-01", "AMX0926B", "2028-09-30", ["10443850"]);
  add("ASH-1105-07", "70004-623-15", "GX4471C", "2027-08-31", ["0000932"]);
  add("ASH-1105-07", "70004-310-10", "OX25L072", "2028-03-31", ["55020417"]);
  // ASH-1105-08: 12 packages, including the real alendronate lots (AC2040A is the one in real recall D-0526-2026)
  add("ASH-1105-08", "70004-145-90", "AM1107B", "2028-06-30", ["20001101", "20001102", "20001103", "20001104"]);
  add("ASH-1105-08", "70004-712-01", "SG1107A", "2027-10-31", ["30007001", "30007002"]);
  add("ASH-1105-08", "0054-0282-59", "AC2105B", "2027-05-31", ["SN0042", "SN0043"]);
  add("ASH-1105-08", "0054-0282-59", "AC2040A", "2026-04-30", ["SN0001"]);
  add("ASH-1105-08", "70004-088-12", "224016", "2028-02-29", ["40016001", "40016002", "40016003"]);
  return out;
}

/** On-shelf packages used as fill demos (labels are printed for these too). */
export const FILL_PACKAGES = [
  { ndc10: "70004-623-15", lot: "GX4471C", serial: "0000907", note: "insulin glargine for Rx 0072210 (Daniel Brooks)" },
  { ndc10: "70004-803-90", lot: "AT24K118", serial: "", note: "atorvastatin for Rx 0072214 (Linda Chen)" }
];

const RECALL_PATIENTS: { name: string; id: string; rx: string; lot: 1 | 3; date: string; ch: string }[] = [
  { name: "Maria Alvarez", id: "S-0417", rx: "0071834", lot: 1, date: "2026-10-09", ch: "se" }, { name: "James Okafor", id: "S-0423", rx: "0071851", lot: 1, date: "2026-10-09", ch: "s" },
  { name: "Linda Chen", id: "S-0448", rx: "0071902", lot: 1, date: "2026-10-10", ch: "se" }, { name: "Robert Haas", id: "S-0461", rx: "0071937", lot: 1, date: "2026-10-13", ch: "c" },
  { name: "Priya Natarajan", id: "S-0490", rx: "0071988", lot: 1, date: "2026-10-15", ch: "se" }, { name: "Grace Miller", id: "S-0502", rx: "0072011", lot: 1, date: "2026-10-16", ch: "e" },
  { name: "Thomas Reyes", id: "S-0519", rx: "0072040", lot: 1, date: "2026-10-18", ch: "se" }, { name: "Aisha Bello", id: "S-0533", rx: "0072077", lot: 1, date: "2026-10-20", ch: "s" },
  { name: "Henry Walsh", id: "S-0541", rx: "0072093", lot: 1, date: "2026-10-21", ch: "se" }, { name: "Sofia Romano", id: "S-0556", rx: "0072120", lot: 1, date: "2026-10-23", ch: "se" },
  { name: "Kevin Tran", id: "S-0563", rx: "0072131", lot: 3, date: "2026-10-24", ch: "s" }, { name: "Ruth Adeyemi", id: "S-0570", rx: "0072144", lot: 3, date: "2026-10-26", ch: "c" },
  { name: "Marcus Lee", id: "S-0578", rx: "0072152", lot: 3, date: "2026-10-27", ch: "se" }, { name: "Ellen Fischer", id: "S-0584", rx: "0072160", lot: 3, date: "2026-10-29", ch: "e" },
  { name: "Omar Haddad", id: "S-0591", rx: "0072171", lot: 3, date: "2026-10-30", ch: "se" }, { name: "Nina Kowalski", id: "S-0597", rx: "0072180", lot: 3, date: "2026-11-02", ch: "s" },
  { name: "Carlos Vega", id: "S-0603", rx: "0072192", lot: 3, date: "2026-11-03", ch: "se" }
];

const slug = (n: string) => n.toLowerCase().replace(/[^a-z]+/g, ".");

/** Bump when the seed changes. In demo mode an older synthetic database is wiped and re-seeded. */
export const SEED_VERSION = "2";

export function seedDatabase(db: Db, cfg: Config, now = Date.now()) {
  if (db.get("SELECT 1 FROM meta WHERE key = 'seeded'")) {
    const v = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'seed_version'")?.value ?? "1";
    if (v === SEED_VERSION || !cfg.demo) return false;
    console.log(`Demo database is seed v${v}; re-seeding synthetic data as v${SEED_VERSION}.`);
    db.clearAll();
  }
  const R = rng(1105);
  const today = new Date(now);
  const Y = today.getUTCFullYear(), M = today.getUTCMonth();
  const at = (iso: string, h = 12) => Date.parse(`${iso}T${pad(h, 2)}:00:00Z`);
  const todayAt = (h: number, m: number) => { const t = Date.UTC(Y, M, today.getUTCDate(), h, m); return t > now ? t - DAY : t; };

  db.tx(() => {
    // ---------- store and staff
    db.run("INSERT INTO stores VALUES (?,?,?,?,?)", "store-7", "Elm Street Pharmacy · Store 7", "0000007", "7 Elm Street (synthetic)", "(555) 010-2200");
    const users: [string, string, string, string, string, string, string, string][] = [
      ["u-rivera", "J. Rivera, PharmD", "j.rivera@elmstreetrx.example", "pharmacist", "JR", "Pharmacist in charge", "#2A2350", "Jordan"],
      ["u-patel", "K. Patel, CPhT", "k.patel@elmstreetrx.example", "technician", "KP", "Technician", "#1F3A35", "Kiran"],
      ["u-diaz", "M. Diaz", "m.diaz@elmstreetrx.example", "cashier", "MD", "Cashier · POS 2", "#3A2A1F", "Maya"],
      ["u-grant", "S. Grant", "s.grant@elmstreetrx.example", "admin", "SG", "Admin · integrations", "#1F2A3A", "Sam"]
    ];
    for (const u of users) db.run("INSERT INTO users (id, store_id, name, email, role, pw_hash, initials, title, tint, first_name) VALUES (?,?,?,?,?,?,?,?,?,?)", u[0], "store-7", u[1], u[2], u[3], hashPassword(DEMO_PASSWORD), u[4], u[5], u[6], u[7]);

    // ---------- products
    for (const p of PRODUCTS) {
      db.run("INSERT INTO products (ndc11, ndc10, gtin, name, strength, form, pack_size, storage, maker, source, reorder_point) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ndc11Digits(p.ndc10), p.ndc10, gtinOf(p.ndc10), p.name, p.strength, p.form, p.pack, p.storage, p.maker, p.source, p.reorder);
    }

    // ---------- helpers
    const locOf = (ndc10: string) => suggestLocation({ ndc11: ndc11Digits(ndc10), name: byNdc(ndc10).name, storage: byNdc(ndc10).storage });
    const lotIds = new Map<string, number>();
    const addLot = (ndc10: string, lot: string, expiry: string) => {
      const id = Number(db.run("INSERT INTO lots (ndc11, lot, expiry, status) VALUES (?,?,?, 'active')", ndc11Digits(ndc10), lot, expiry).lastInsertRowid);
      lotIds.set(`${ndc10}|${lot}`, id);
      return id;
    };
    const addPkg = (ndc10: string, lot: string, serial: string, expiry: string, o: { status?: PackageStatus; location?: string; zone?: string; delivery?: string | null; recvAt: number; by?: string }) => {
      const loc = locOf(ndc10);
      const id = Number(db.run(
        "INSERT INTO packages (serial, lot_id, gtin, expiry, location, zone, status, delivery_id, received_at, received_by) VALUES (?,?,?,?,?,?,?,?,?,?)",
        serial, lotIds.get(`${ndc10}|${lot}`)!, gtinOf(ndc10), expiry, o.location ?? loc.location, o.zone ?? loc.zone, o.status ?? "on_shelf", o.delivery ?? null, o.recvAt, o.by ?? "K. Patel, CPhT"
      ).lastInsertRowid);
      return id;
    };
    const ev = (kind: string, lotKey: string, t: number, who: string, note: string, pkg: number | null = null) =>
      db.run("INSERT INTO lot_events (at, kind, lot_id, package_id, user_name, note) VALUES (?,?,?,?,?,?)", t, kind, lotIds.get(lotKey)!, pkg, who, note);

    // ---------- patients (recall patients, queue patients, a pool for older fills)
    const addPatient = (id: string, name: string, ch: string, i: number, extra: { dob?: string; allergies?: string } = {}) => {
      const [first, last] = [name.split(" ")[0]!, name.split(" ").slice(1).join(" ")];
      db.run("INSERT INTO patients (id, name, dob, phone, email, preferred, sms_consent, email_consent, allergies) VALUES (?,?,?,?,?,?,?,?,?)",
        id, name, extra.dob ?? `19${50 + (i % 45)}-${pad(1 + (i % 12), 2)}-${pad(1 + ((i * 7) % 28), 2)}`,
        ch.includes("s") || ch.includes("c") ? `(555) 010-${pad(100 + i, 4).slice(-4)}` : "", ch.includes("e") ? `${slug(first + " " + last)}@example.com` : "",
        ch.includes("s") ? "sms" : ch.includes("e") ? "email" : "phone", ch.includes("s") ? 1 : 0, ch.includes("e") ? 1 : 0, extra.allergies ?? "");
    };
    RECALL_PATIENTS.forEach((p, i) => addPatient(p.id, p.name, p.ch, i + 1));
    // Call-only patients have a phone number but no text or email consent.
    addPatient("S-0612", "Daniel Brooks", "se", 42, { dob: "1968-03-14", allergies: "penicillin" });
    db.run("UPDATE patients SET phone = '(555) 010-0142', email = 'd.brooks@example.com' WHERE id = 'S-0612'");
    // Linda, James, Priya, Grace already exist above as recall patients; the queue reuses them.
    const pool: string[] = [];
    const firsts = ["Ana", "Ben", "Chloe", "Dev", "Eli", "Faye", "Gus", "Hana", "Ivan", "Jade", "Kai", "Lena", "Milo", "Nora", "Owen", "Pia", "Quinn", "Rae", "Sam", "Tess"];
    const lasts = ["Abbott", "Bishop", "Cruz", "Dunn", "Evans", "Frost", "Gill", "Hart", "Ito", "Jain"];
    for (let i = 0; i < 30; i++) {
      const id = `S-${pad(700 + i, 4)}`;
      addPatient(id, `${firsts[i % firsts.length]} ${lasts[(i * 3) % lasts.length]}`, i % 4 === 0 ? "s" : "se", 60 + i);
      pool.push(id);
    }

    // ---------- the recalled methylprednisolone lots (received Oct 4, 122 + 92 packages)
    const MP = "70004-417-05";
    const mpExp = "2027-09-30";
    const mpLoc = "Aisle 3 · Bay B · Shelf 2";
    const mpLots: [string, number, number, number, 1 | 3][] = [["PRORX050925-1", 122, 10, 100001, 1], ["PRORX050925-3", 92, 7, 300001, 3]];
    let rxSeq = 0;
    for (const [lot, recv, out, first, which] of mpLots) {
      addLot(MP, lot, mpExp);
      const key = `${MP}|${lot}`;
      const pk: number[] = [];
      for (let n = 0; n < recv; n++) pk.push(addPkg(MP, lot, String(first + n), mpExp, { location: mpLoc, zone: "shelf", delivery: "ASH-1001-02", recvAt: at("2026-10-04", 14) }));
      ev("Received", key, at("2026-10-04", 14), "K. Patel, CPhT", `${recv} units from Ashgrove · TI/TS verified`);
      ev("Shelved", key, at("2026-10-04", 15), "K. Patel, CPhT", mpLoc);
      RECALL_PATIENTS.filter((p) => p.lot === which).forEach((p, k) => {
        const rxId = Number(db.run("INSERT INTO prescriptions (rx, patient_id, ndc11, drug, qty, directions, prescriber, refills, status, due) VALUES (?,?,?,?,?,?,?,?,?,?)",
          p.rx, p.id, ndc11Digits(MP), "Methylprednisolone acetate 40 mg/mL · 5 mL", 1, "Inject as directed by your clinician", "Dr. A. Nwosu", 0, "sold", p.date).lastInsertRowid);
        db.run("UPDATE packages SET status = 'dispensed' WHERE id = ?", pk[k]);
        db.run("INSERT INTO dispenses (rx_id, package_id, state, filled_by, filled_at, verified_by, verified_at, sold_at, register, id_checked, counseled, signature, contact_json, label_printed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          rxId, pk[k], "sold", "K. Patel, CPhT", at(p.date, 15), "J. Rivera, PharmD", at(p.date, 16), at(p.date, 17), "POS 2", 1, 1, 1, JSON.stringify({ channels: p.ch }), 1);
        ev("Filled", key, at(p.date, 15), "K. Patel, CPhT", `Rx ${p.rx} · ${p.id}`, pk[k]);
        ev("Sold", key, at(p.date, 17), "M. Diaz", `Rx ${p.rx}`, pk[k]);
        rxSeq++;
      });
    }

    // ---------- other named lots
    const named: { ndc10: string; lot: string; exp: string; recv: number; out: number; first: number | string; recvDate: string; loc?: string }[] = [
      { ndc10: "70004-623-15", lot: "GX4471C", exp: "2027-08-31", recv: 23, out: 6, first: 900, recvDate: "2026-10-12" },
      { ndc10: "70004-088-12", lot: "224015", exp: monthEnd(Y, M), recv: 30, out: 21, first: 40015000, recvDate: "2026-06-20" },
      { ndc10: "70004-226-01", lot: "AMX0926B", exp: "2028-09-30", recv: 13, out: 0, first: 10443800, recvDate: "2026-10-28" },
      { ndc10: "70004-226-01", lot: "AMX0626C", exp: "2028-01-31", recv: 22, out: 2, first: 10440000, recvDate: "2026-08-19" },
      { ndc10: "70004-310-10", lot: "OX25L072", exp: "2028-03-31", recv: 15, out: 2, first: 55020400, recvDate: "2026-09-02" },
      { ndc10: "70004-145-90", lot: "AM9921F", exp: monthEnd(Y, M + 1), recv: 12, out: 6, first: 99210000, recvDate: "2026-05-14" },
      { ndc10: "70004-712-01", lot: "SG0337A", exp: "2027-05-31", recv: 10, out: 6, first: 33700000, recvDate: "2026-07-08" },
      { ndc10: "70004-803-90", lot: "AT24K118", exp: "2027-12-31", recv: 20, out: 6, first: 24118000, recvDate: "2026-09-21" }
    ];
    const seen = new Set<string>();
    const legacyFill = (lotKey: string, pkgId: number, t: number, who: string) => {
      const patient = R.pick(pool);
      const prod = db.get<{ ndc11: string; name: string }>("SELECT p.ndc11, p.name FROM packages k JOIN lots l ON l.id = k.lot_id JOIN products p ON p.ndc11 = l.ndc11 WHERE k.id = ?", pkgId)!;
      const rxNo = pad(60100 + (++rxSeq), 7);
      const rxId = Number(db.run("INSERT INTO prescriptions (rx, patient_id, ndc11, drug, qty, directions, prescriber, refills, status, due) VALUES (?,?,?,?,?,?,?,?,?,?)",
        rxNo, patient, prod.ndc11, prod.name, 1, "Use as directed", "Dr. L. Moreno", 2, "sold", new Date(t).toISOString().slice(0, 10)).lastInsertRowid);
      db.run("UPDATE packages SET status = 'dispensed' WHERE id = ?", pkgId);
      const legacy = false;
      db.run("INSERT INTO dispenses (rx_id, package_id, state, filled_by, filled_at, verified_by, verified_at, sold_at, register, id_checked, counseled, signature, contact_json, label_printed) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rxId, legacy ? null : pkgId, "sold", "K. Patel, CPhT", t, "J. Rivera, PharmD", t + 600_000, t + 1_800_000, "POS 2", 1, 1, 1, "{}", 1);
      if (!legacy) { ev("Sold", lotKey, t + 1_800_000, who, `Rx ${rxNo}`, pkgId); }
    };
    for (const n of named) {
      const key = `${n.ndc10}|${n.lot}`;
      if (!seen.has(key)) { addLot(n.ndc10, n.lot, n.exp); seen.add(key); }
      const pk: number[] = [];
      for (let i = 0; i < n.recv; i++) {
        const serial = n.ndc10 === "70004-623-15" ? pad(Number(n.first) + i, 7) : String(Number(n.first) + i);
        pk.push(addPkg(n.ndc10, n.lot, serial, n.exp, { recvAt: at(n.recvDate, 10), delivery: "ASH-0000-00" }));
      }
      ev("Received", key, at(n.recvDate, 10), "K. Patel, CPhT", `${n.recv} units · TI/TS verified`);
      for (let i = 0; i < n.out; i++) legacyFill(key, pk[i]!, at(n.recvDate, 12) + (i + 3) * DAY, "M. Diaz");
    }

    // ---------- filler lots so the expiry chart and the inventory table look like a real store
    const wanted = [6, 9, 8, 4, 3]; // lots expiring this month and the next four
    const have = [1, 1, 0, 0, 0];   // named lots already expiring in those months (224015, AM9921F)
    const fillProducts = PRODUCTS.filter((p) => !["70004-310-10", "70004-417-05", "0054-0282-59"].includes(p.ndc10));
    let fl = 0;
    const filler = (ndc10: string, exp: string, month: number) => {
      const p = byNdc(ndc10);
      const lot = `${p.name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase()}${R.int(10, 99)}${"ABCDEFGHJKLMNPQRSTUVWXYZ"[R.int(0, 23)]}${R.int(100, 999)}`;
      if (seen.has(`${ndc10}|${lot}`)) return;
      seen.add(`${ndc10}|${lot}`);
      addLot(ndc10, lot, exp);
      const recv = R.int(6, 26);
      const out = Math.floor(recv * (month < 5 ? R.int(40, 75) : R.int(0, 35)) / 100);
      const recvDate = isoFromOffset(now, -R.int(40, 150));
      const key = `${ndc10}|${lot}`;
      const pk: number[] = [];
      for (let i = 0; i < recv; i++) pk.push(addPkg(ndc10, lot, serial8(lot, i), exp, { recvAt: at(recvDate, 11), delivery: "ASH-0000-00" }));
      ev("Received", key, at(recvDate, 11), "K. Patel, CPhT", `${recv} units · TI/TS verified`);
      for (let i = 0; i < out; i++) legacyFill(key, pk[i]!, at(recvDate, 13) + (i + 2) * DAY, "M. Diaz");
      fl++;
    };
    wanted.forEach((count, month) => {
      for (let i = 0; i < count - have[month]!; i++) filler(fillProducts[(fl + i) % fillProducts.length]!.ndc10, monthEnd(Y, M + month), month);
    });
    for (let i = 0; i < 28; i++) filler(fillProducts[i % fillProducts.length]!.ndc10, monthEnd(Y, M + R.int(6, 22)), 9);

    // ---------- delivery ASH-1105-07: 35 of 38 packages already checked in today
    const lines07: [string, string, string, number, string][] = [
      ["70004-801-90", "Lisinopril 10 mg · 90 tab", "LS0811A", 6, "2028-02-29"], ["70004-802-10", "Metformin ER 500 mg · 100 tab", "MF2604K", 8, "2028-05-31"],
      ["70004-803-90", "Atorvastatin 20 mg · 90 tab", "AT24K118", 6, "2027-12-31"], ["70004-804-30", "Sertraline 50 mg · 30 tab", "SR1003C", 10, "2028-01-31"],
      ["70004-805-01", "Albuterol HFA 90 mcg", "AB77Q2", 5, "2027-10-31"]
    ];
    db.run("INSERT INTO deliveries (id, wholesaler, status, expected, shipper_temp_c, ti_doc, arrived, note) VALUES (?,?,?,?,?,?,?,?)", "ASH-1105-07", "Ashgrove Distribution", "open", 38, 3.8, "TI/TS EPCIS 2.0 · 38 serials", "Today 17:25", "2 totes · 1 refrigerated");
    db.run("INSERT INTO deliveries (id, wholesaler, status, expected, shipper_temp_c, ti_doc, arrived, note) VALUES (?,?,?,?,?,?,?,?)", "ASH-1105-08", "Ashgrove Distribution", "open", 12, 4.1, "TI/TS EPCIS 2.0 · 12 serials", "Today 19:10", "1 tote · 1 refrigerated");
    let lineNo = 0;
    for (const [ndc10, name, lot, qty, exp] of lines07) {
      lineNo++;
      if (!lotIds.has(`${ndc10}|${lot}`)) addLot(ndc10, lot, exp);
      const key = `${ndc10}|${lot}`;
      for (let i = 0; i < qty; i++) {
        const serial = serial8(lot, 500 + i);
        const pkg = addPkg(ndc10, lot, serial, exp, { delivery: "ASH-1105-07", recvAt: todayAt(17, 20) + i * 60_000 });
        db.run("INSERT OR IGNORE INTO ti_records (delivery_id, gtin, lot, serial, expiry) VALUES (?,?,?,?,?)", "ASH-1105-07", gtinOf(ndc10), lot, serial, exp);
        void pkg;
      }
      ev("Received", key, todayAt(17, 5 + lineNo), "K. Patel, CPhT", `${qty} units · delivery ASH-1105-07`);
      db.run("INSERT INTO delivery_lines (delivery_id, line_no, ndc11, name, expected_qty, received_qty, sub) VALUES (?,?,?,?,?,?,?)", "ASH-1105-07", lineNo, ndc11Digits(ndc10), name, qty, qty, `Lot ${lot} · exp ${exp.slice(0, 7)}`);
    }
    const lines07b: [string, string, number][] = [["70004-226-01", "Amoxicillin 500 mg · 100 cap", 1], ["70004-623-15", "Insulin glargine 100 U/mL · 5 pens", 1], ["70004-310-10", "Oxycodone HCl 5 mg · 100 tab", 1]];
    for (const [ndc10, name, qty] of lines07b) { lineNo++; db.run("INSERT INTO delivery_lines (delivery_id, line_no, ndc11, name, expected_qty, received_qty, sub) VALUES (?,?,?,?,?,?,?)", "ASH-1105-07", lineNo, ndc11Digits(ndc10), name, qty, 0, "Waiting for scan"); }
    const lines08: [string, string, number][] = [["70004-145-90", "Amlodipine 5 mg · 90 tab", 4], ["70004-712-01", "Semaglutide 1 mg/dose pen", 2], ["0054-0282-59", "Alendronate sodium oral solution 70 mg/75 mL", 3], ["70004-088-12", "Ondansetron ODT 4 mg · 30 ct", 3]];
    lines08.forEach(([ndc10, name, qty], i) => db.run("INSERT INTO delivery_lines (delivery_id, line_no, ndc11, name, expected_qty, received_qty, sub) VALUES (?,?,?,?,?,?,?)", "ASH-1105-08", i + 1, ndc11Digits(ndc10), name, qty, 0, "Waiting for scan"));
    for (const e of expectedPackages()) db.run("INSERT OR IGNORE INTO ti_records (delivery_id, gtin, lot, serial, expiry) VALUES (?,?,?,?,?)", e.delivery, gtinOf(e.ndc10), e.lot, e.serial, e.expiry);

    // ---------- today's fill queue (insulin and atorvastatin come from named lots; the others reuse existing stock)
    const queue: [string, string, string, string, string, string, string, string][] = [
      ["0072210", "S-0612", "70004-623-15", "Insulin glargine 100 units/mL · 5 × 3 mL pens", "Inject 20 units under the skin every morning and at bedtime", "Dr. A. Nwosu", "to_fill", "waiting"],
      ["0072214", "S-0448", "70004-803-90", "Atorvastatin 20 mg · 90 tab", "Take 1 tablet by mouth daily", "Dr. L. Moreno", "to_fill", "18:45"],
      ["0072219", "S-0423", "70004-226-01", "Amoxicillin 500 mg · 100 cap", "Take 1 capsule three times daily for 10 days", "Dr. L. Moreno", "to_verify", "19:00"],
      ["0072198", "S-0490", "70004-804-30", "Sertraline 50 mg · 30 tab", "Take 1 tablet by mouth daily", "Dr. L. Moreno", "ready", "in bin B-14"],
      ["0072187", "S-0502", "70004-801-90", "Lisinopril 10 mg · 90 tab", "Take 1 tablet by mouth daily", "Dr. L. Moreno", "ready", "in bin A-03"]
    ];
    for (const [rx, pid, ndc10, drug, dir, doc, status, due] of queue) {
      const rxId = Number(db.run("INSERT INTO prescriptions (rx, patient_id, ndc11, drug, qty, directions, prescriber, refills, status, due) VALUES (?,?,?,?,?,?,?,?,?,?)", rx, pid, ndc11Digits(ndc10), drug, 1, dir, doc, rx === "0072210" ? 3 : 2, status, due).lastInsertRowid);
      if (status === "to_fill") continue;
      // already filled: tie the oldest on-shelf package of the right NDC to the prescription
      const pkg = db.get<{ id: number; lot_id: number }>("SELECT k.id, k.lot_id FROM packages k JOIN lots l ON l.id = k.lot_id WHERE l.ndc11 = ? AND k.status = 'on_shelf' ORDER BY l.expiry, k.id LIMIT 1", ndc11Digits(ndc10))!;
      db.run("UPDATE packages SET status = 'dispensed' WHERE id = ?", pkg.id);
      const verified = status === "ready";
      db.run("INSERT INTO dispenses (rx_id, package_id, state, filled_by, filled_at, verified_by, verified_at, register, label_printed, contact_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        rxId, pkg.id, verified ? "verified" : "filled", "K. Patel, CPhT", todayAt(17, 30), verified ? "J. Rivera, PharmD" : null, verified ? todayAt(17, 50) : null, "POS 2", 1, "{}");
      db.run("INSERT INTO lot_events (at, kind, lot_id, package_id, user_name, note) VALUES (?,?,?,?,?,?)", todayAt(17, 30), "Filled", pkg.lot_id, pkg.id, "K. Patel, CPhT", `Rx ${rx}`);
    }

    // ---------- days supply as written on each queue order. 0072210 is written as 90 days on purpose: Rx Watcher should catch it.
    for (const [rx, days] of [["0072210", 90], ["0072214", 90], ["0072219", 10], ["0072198", 30], ["0072187", 90]] as const) db.run("UPDATE prescriptions SET days_supply = ? WHERE rx = ?", days, rx);

    // ---------- Daniel Brooks: the profile the Patients screen and Rx Watcher read (synthetic)
    db.run("UPDATE patients SET conditions = ?, allergies = ? WHERE id = 'S-0612'", "Type 2 diabetes, hypertension, high cholesterol", "penicillin");
    const hist: [string, string, string, string, string, string, number, number, string, number, number][] = [
      ["2026-10-14", "70004-802-10", "Metformin ER 500 mg · 60 tab", "2 tablets with evening meal", "MF2604K", "Dr. A. Nwosu", 60, 30, "Active", 1, 4],
      ["2026-10-14", "70004-801-90", "Lisinopril 10 mg · 30 tab", "1 tablet daily", "LS0811A", "Dr. A. Nwosu", 30, 30, "Active", 1, 4],
      ["2026-09-19", "", "Atorvastatin 40 mg · 30 tab", "1 tablet at bedtime", "AT24K301", "Dr. A. Nwosu", 30, 30, "Active", 0, 5],
      ["2026-09-02", "", "Prednisone 20 mg · 10 tab", "2 tablets daily for 5 days", "PD7711B", "Dr. L. Ortiz (urgent care)", 10, 5, "Completed", 0, 0],
      ["2026-08-01", "70004-623-15", "Insulin glargine 100 U/mL · 5 pens", "20 units at bedtime", "GX3920A", "Dr. A. Nwosu", 1, 68, "Replaced", 0, 3],
      ["2026-03-18", "70004-623-15", "Insulin glargine 100 U/mL · 5 pens", "18 units at bedtime", "GX3101B", "Dr. A. Nwosu", 1, 75, "Completed", 0, 4],
      ["2026-03-03", "", "Ciprofloxacin 500 mg · 14 tab", "1 tablet twice daily for 7 days", "CP1102", "Dr. L. Ortiz (urgent care)", 14, 7, "Completed", 0, 0]
    ];
    for (const h of hist) db.run("INSERT INTO med_history (patient_id, filled_on, ndc11, drug, sig, lot, prescriber, qty, days_supply, status, auto_refill, refills_left) VALUES ('S-0612',?,?,?,?,?,?,?,?,?,?,?)",
      h[0], h[1] ? ndc11Digits(h[1]) : "", h[2], h[3], h[4], h[5], h[6], h[7], h[8], h[9], h[10]);
    // A second patient with a clean profile, so the matches list on Patients has more than one real row.
    db.run("INSERT INTO med_history (patient_id, filled_on, ndc11, drug, sig, lot, prescriber, qty, days_supply, status, auto_refill, refills_left) VALUES ('S-0448',?,?,?,?,?,?,?,?,?,?,?)",
      "2026-08-12", ndc11Digits("70004-803-90"), "Atorvastatin 20 mg · 90 tab", "1 tablet by mouth daily", "AT24K001", "Dr. L. Moreno", 90, 90, "Active", 0, 2);

    // ---------- recent activity shown on Today (the feed also fills from live actions)
    const feed: [number, number, string, string, string][] = [
      [18, 12, "Sold", "70004-803-90|AT24K118", "POS 2 · M. Diaz"], [18, 7, "Filled", "70004-623-15|GX4471C", "K. Patel, CPhT"],
      [17, 55, "Received", "70004-226-01|AMX0926B", "K. Patel, CPhT"], [17, 30, "Returned", "70004-088-12|224015", "J. Rivera, PharmD"]
    ];
    for (const [h, m, kind, key, who] of feed) ev(kind, key, todayAt(h, m), who, kind === "Returned" ? "Returned to vendor" : "");

    // ---------- the recall fax in the inbox (rendered image + the text a fax server would store)
    db.run("INSERT INTO fax_inbox (received_at, from_name, pages, image, text, status, recall_id) VALUES (?,?,?,?,?,?,?)",
      todayAt(2, 14), "Hollow Creek Pharma", 2, "/fax/recall-d0417.png", "", "new", "D-0417-2026");

    db.run("INSERT INTO tasks (title, sub, href, due, dot) VALUES (?,?,?,?,?)", "Count Schedule II safe", "Biennial count · 14 products", "/inventory?filter=ctrl", "Fri", "#5E687B");
    db.run("INSERT INTO meta (key, value) VALUES ('seeded', ?)", String(now));
    db.run("INSERT INTO meta (key, value) VALUES ('seed_version', ?)", SEED_VERSION);
    db.run("INSERT INTO meta (key, value) VALUES ('last_sync', ?)", String(now - 2 * 60_000));
  });
  return true;
}

function isoFromOffset(now: number, days: number): string {
  return new Date(now + days * DAY).toISOString().slice(0, 10);
}

export function ensureFaxAsset(cfg: Config) {
  const dir = path.join(cfg.assetsDir, "fax");
  fs.mkdirSync(dir, { recursive: true });
}
