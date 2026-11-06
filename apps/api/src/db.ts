import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

// vite-node strips the "node:" prefix for sqlite, so load it through require.
const require = createRequire(import.meta.url);
const { DatabaseSync: Sqlite } = require("node:sqlite") as typeof import("node:sqlite");

type Param = string | number | bigint | null;
const clean = (p: unknown[]): Param[] => p.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : (v as Param)));

export class Db {
  readonly raw: DatabaseSync;
  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new Sqlite(file);
    this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  all<T = Record<string, any>>(sql: string, ...p: unknown[]): T[] {
    return this.raw.prepare(sql).all(...clean(p)).map((r) => ({ ...r })) as T[];
  }
  get<T = Record<string, any>>(sql: string, ...p: unknown[]): T | undefined {
    const r = this.raw.prepare(sql).get(...clean(p));
    return r ? ({ ...r } as T) : undefined;
  }
  run(sql: string, ...p: unknown[]) {
    return this.raw.prepare(sql).run(...clean(p));
  }
  tx<T>(fn: () => T): T {
    this.raw.exec("BEGIN");
    try { const out = fn(); this.raw.exec("COMMIT"); return out; } catch (e) { this.raw.exec("ROLLBACK"); throw e; }
  }

  private migrate() {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS recalls (
        id TEXT PRIMARY KEY, recall_number TEXT, classification TEXT, status TEXT,
        product_description TEXT, code_info TEXT, reason TEXT, firm TEXT, report_date TEXT,
        raw_json TEXT, cached INTEGER DEFAULT 0, demo INTEGER DEFAULT 0,
        needs_review INTEGER DEFAULT 0, notes TEXT DEFAULT '', warnings_json TEXT DEFAULT '[]',
        passes_json TEXT DEFAULT '{}', llm TEXT, error TEXT,
        created_at INTEGER, confirmed_at INTEGER, ready_at INTEGER, pipeline_ms INTEGER
      );
      CREATE TABLE IF NOT EXISTS extractions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id TEXT, kind TEXT, value TEXT, expiry TEXT,
        confidence REAL, source TEXT, confirmed INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS ix_ext_recall ON extractions(recall_id);
      CREATE TABLE IF NOT EXISTS dispenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id TEXT, rx_number TEXT, patient_id TEXT,
        pharmacy_gln TEXT, pharmacy_name TEXT, ndc TEXT, lot TEXT, serial TEXT, qty INTEGER,
        fill_date TEXT, source TEXT, confidence REAL, serial_inferred INTEGER DEFAULT 1, event_written INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS ix_disp_recall ON dispenses(recall_id);
      CREATE TABLE IF NOT EXISTS quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id TEXT, pharmacy_gln TEXT, gtin TEXT, serial TEXT,
        lot TEXT, shelf TEXT, status TEXT DEFAULT 'held', pulled INTEGER DEFAULT 0, pickup INTEGER DEFAULT 0,
        UNIQUE(gtin, serial)
      );
      CREATE TABLE IF NOT EXISTS outreach (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id TEXT, patient_id TEXT, pharmacy_gln TEXT, fill_date TEXT,
        draft_text TEXT, reading_grade REAL, written_by TEXT, status TEXT DEFAULT 'draft', approved_by TEXT, approved_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recall_ids TEXT, avoid_heat INTEGER, stops_json TEXT, geojson TEXT,
        cold_chain_warnings TEXT, created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS rpa_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id TEXT, seq INTEGER, json TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_steps_recall ON rpa_steps(recall_id);
      CREATE TABLE IF NOT EXISTS fill_scans (
        id INTEGER PRIMARY KEY AUTOINCREMENT, rx_number TEXT, pharmacy_gln TEXT, raw_gs1 TEXT, gtin TEXT, ndc TEXT,
        lot TEXT, expiry TEXT, serial TEXT, scanned_at INTEGER, device TEXT, verdict TEXT, flags_json TEXT DEFAULT '[]',
        recall_id TEXT, drug TEXT, drug_source TEXT, labeler TEXT, saved_ms INTEGER,
        writeback_status TEXT DEFAULT 'none', writeback_note TEXT, writeback_readback TEXT, writeback_error TEXT, writeback_attempts INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS ix_scans_rx ON fill_scans(rx_number);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    `);
  }

  clearAll() {
    this.raw.exec("DELETE FROM recalls; DELETE FROM extractions; DELETE FROM dispenses; DELETE FROM quarantine; DELETE FROM outreach; DELETE FROM routes; DELETE FROM rpa_steps; DELETE FROM fill_scans;");
  }
}
