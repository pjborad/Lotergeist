import crypto from "node:crypto";
import { ndc10ToGtin14, ndc10ToNdc11, parseNdc } from "@bsrx/gs1";

export const DAY = 86_400_000;

export type Role = "technician" | "pharmacist" | "cashier";
export type Zone = "shelf" | "cold" | "controlled" | "quarantine" | "rtv";
export type Storage = "room" | "cold" | "c2";
export type PackageStatus = "pending_putaway" | "on_shelf" | "dispensed" | "quarantined" | "returned" | "destroyed" | "adjusted";

/** Stored NDC: 11 digits, no hyphens. */
export const ndc11Digits = (ndc10: string) => ndc10ToNdc11(ndc10).replace(/-/g, "");
export const gtinOf = (ndc10: string) => ndc10ToGtin14(ndc10);

/** "70004041705" -> "70004-0417-05" */
export const ndc11Pretty = (d: string) => `${d.slice(0, 5)}-${d.slice(5, 9)}-${d.slice(9)}`;

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(a: readonly T[]): T => a[Math.floor(next() * a.length)]! };
}

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashPassword(pw: string, salt = crypto.randomBytes(16).toString("hex")): string {
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const got = crypto.scryptSync(pw, salt, 32);
  const want = Buffer.from(key, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ------------------------------------------------------------------ put-away rules

export interface Suggestion { location: string; zone: Zone; zoneLabel: "Shelf" | "Cold chain" | "Controlled"; why: string }

/** Where a package goes. Deterministic per product, so the same drug always lands in the same spot. */
export function suggestLocation(p: { ndc11: string; name: string; storage: Storage }): Suggestion {
  const h = hash(p.ndc11);
  if (p.storage === "cold") {
    return {
      location: `Fridge F1 · Shelf ${1 + (h % 3)} · Bin ${"ABC"[(h >>> 3) % 3]}`, zone: "cold", zoneLabel: "Cold chain",
      why: "Refrigerate at 2–8 °C. Put away within 15 minutes of opening the tote."
    };
  }
  if (p.storage === "c2") {
    return {
      location: `C-II Safe · Drawer ${1 + (h % 3)}`, zone: "controlled", zoneLabel: "Controlled",
      why: "Schedule II. The perpetual count goes up by one; a second staff member must witness."
    };
  }
  const first = (p.name.trim()[0] ?? "A").toUpperCase();
  const section = first <= "C" ? ["Aisle 2", "A–C"] : first <= "L" ? ["Aisle 3", "D–L"] : first <= "R" ? ["Aisle 4", "M–R"] : ["Aisle 5", "S–Z"];
  return {
    location: `${section[0]} · Bay ${"ABC"[(h >>> 2) % 3]} · Shelf ${1 + ((h >>> 4) % 4)} · Bin ${1 + ((h >>> 6) % 24)}`, zone: "shelf", zoneLabel: "Shelf",
    why: `Room temperature. Shelved by generic name, ${section[1]} section.`
  };
}

// ------------------------------------------------------------------ dates

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const monthEnd = (y: number, m0: number) => isoDate(new Date(Date.UTC(y, m0 + 1, 0)));

/** Whole months from `from` (YYYY-MM-DD) to `to`. */
export function monthsBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z"), b = new Date(to + "T00:00:00Z");
  let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) m -= 1;
  return m;
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY);

/** Ledger expiry from a GS1 expiry (YYYY-MM-DD) or a month-only value (YYYY-MM -> month end). */
export function normalizeExpiry(e: string | undefined | null): string {
  if (!e) return "";
  if (/^\d{4}-\d{2}$/.test(e)) { const [y, m] = e.split("-").map(Number); return monthEnd(y!, m! - 1); }
  return /^\d{4}-\d{2}-\d{2}$/.test(e) ? e : "";
}

export function ndcFromAny(input: string): { ndc11: string; ndc10: string | null } | null {
  const p = parseNdc(input.trim());
  if (!p) return null;
  return { ndc11: p.length === 11 ? p.digits : ndc11Digits(input.trim()), ndc10: p.length === 10 ? input.trim() : null };
}
