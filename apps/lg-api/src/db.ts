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
      CREATE TABLE IF NOT EXISTS stores (id TEXT PRIMARY KEY, name TEXT, ncpdp TEXT, address TEXT, phone TEXT);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, store_id TEXT, name TEXT, email TEXT UNIQUE, role TEXT, pw_hash TEXT, initials TEXT, title TEXT,
        failed INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0, tint TEXT, first_name TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT, created INTEGER, expires INTEGER, trusted INTEGER, workstation TEXT);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, user_id TEXT, user_name TEXT, store_id TEXT, workstation TEXT,
        action TEXT, entity TEXT, entity_id TEXT, before_json TEXT, after_json TEXT
      );
      CREATE TABLE IF NOT EXISTS products (
        ndc11 TEXT PRIMARY KEY, ndc10 TEXT, gtin TEXT UNIQUE, name TEXT, strength TEXT, form TEXT, pack_size TEXT, storage TEXT,
        maker TEXT, source TEXT, reorder_point INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS lots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ndc11 TEXT, lot TEXT, expiry TEXT, status TEXT DEFAULT 'active', UNIQUE(ndc11, lot)
      );
      CREATE TABLE IF NOT EXISTS packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, serial TEXT, lot_id INTEGER, gtin TEXT, expiry TEXT, location TEXT, zone TEXT, status TEXT,
        delivery_id TEXT, received_at INTEGER, received_by TEXT, manual INTEGER DEFAULT 0, note TEXT, UNIQUE(gtin, serial)
      );
      CREATE INDEX IF NOT EXISTS ix_pkg_lot ON packages(lot_id, status);
      CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, wholesaler TEXT, status TEXT, expected INTEGER, shipper_temp_c REAL, ti_doc TEXT, arrived TEXT, note TEXT);
      CREATE TABLE IF NOT EXISTS delivery_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id TEXT, line_no INTEGER, ndc11 TEXT, name TEXT, expected_qty INTEGER, received_qty INTEGER DEFAULT 0, sub TEXT
      );
      CREATE TABLE IF NOT EXISTS ti_records (delivery_id TEXT, gtin TEXT, lot TEXT, serial TEXT, expiry TEXT, UNIQUE(delivery_id, gtin, serial));
      CREATE TABLE IF NOT EXISTS problems (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_id TEXT, package_id INTEGER, kind TEXT, note TEXT, at INTEGER, by TEXT);
      CREATE TABLE IF NOT EXISTS patients (
        id TEXT PRIMARY KEY, name TEXT, dob TEXT, phone TEXT, email TEXT, preferred TEXT, sms_consent INTEGER DEFAULT 0,
        email_consent INTEGER DEFAULT 0, sms_opt_out INTEGER DEFAULT 0, allergies TEXT DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS prescriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, rx TEXT UNIQUE, patient_id TEXT, ndc11 TEXT, drug TEXT, qty INTEGER DEFAULT 1,
        directions TEXT, prescriber TEXT, refills INTEGER DEFAULT 0, status TEXT, due TEXT
      );
      CREATE TABLE IF NOT EXISTS dispenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT, rx_id INTEGER, package_id INTEGER, state TEXT, filled_by TEXT, filled_at INTEGER,
        verified_by TEXT, verified_at INTEGER, sold_at INTEGER, register TEXT, id_checked INTEGER DEFAULT 0, counseled INTEGER DEFAULT 0,
        signature INTEGER DEFAULT 0, contact_json TEXT, label_printed INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS ix_disp_pkg ON dispenses(package_id);
      CREATE TABLE IF NOT EXISTS lot_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, kind TEXT, lot_id INTEGER, package_id INTEGER, user_name TEXT, note TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_ev_lot ON lot_events(lot_id, at);
      CREATE TABLE IF NOT EXISTS recalls (
        id TEXT PRIMARY KEY, step TEXT DEFAULT 'lookup', status TEXT DEFAULT 'new', classification TEXT, level TEXT, reason TEXT, firm TEXT,
        initiated TEXT, product TEXT, code_info TEXT, product_description TEXT, raw_json TEXT, source TEXT, fax_text TEXT, created_at INTEGER,
        created_by TEXT, cached INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS recall_lots (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id TEXT, lot TEXT, ndc11 TEXT, expiry TEXT, confidence REAL, source TEXT,
        confirmed_by TEXT, confirmed_at INTEGER, UNIQUE(recall_id, lot)
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id TEXT, patient_id TEXT, rx TEXT, channel TEXT, template_version INTEGER,
        merged_text TEXT, subject TEXT, status TEXT, queued_at INTEGER, sent_at INTEGER, delivered_at INTEGER, error TEXT
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT, to_addr TEXT, subject TEXT, body TEXT, status TEXT, created_at INTEGER,
        delivered_at INTEGER, notification_id INTEGER, provider TEXT
      );
      CREATE TABLE IF NOT EXISTS recall_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id TEXT, kind TEXT, payload TEXT, at INTEGER, by TEXT);
      CREATE TABLE IF NOT EXISTS fax_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER, from_name TEXT, pages INTEGER, image TEXT, text TEXT, status TEXT, recall_id TEXT
      );
      CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, sub TEXT, href TEXT, due TEXT, dot TEXT, done INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

      -- Rx Watcher output: every finding an agent produced, with the human decision stored on the review
      CREATE TABLE IF NOT EXISTS rx_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT, rx TEXT, run_id INTEGER, agent TEXT, rule TEXT, severity TEXT, title TEXT, body TEXT,
        evidence TEXT, source TEXT DEFAULT 'rule', at INTEGER
      );
      CREATE INDEX IF NOT EXISTS ix_find_rx ON rx_findings(rx, run_id);
      CREATE TABLE IF NOT EXISTS agent_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT, subject TEXT, status TEXT, model TEXT, prompt_version TEXT, rules_version TEXT,
        input_hash TEXT, summary TEXT, latency_ms INTEGER, error TEXT, decision TEXT, decided_by TEXT, decided_at INTEGER, at INTEGER
      );
      CREATE TABLE IF NOT EXISTS prescriber_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, rx TEXT, direction TEXT, type TEXT, script_id TEXT, prescriber TEXT, body TEXT, status TEXT,
        response_json TEXT, created_by TEXT, created_at INTEGER, responded_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS med_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT, filled_on TEXT, ndc11 TEXT, drug TEXT, sig TEXT, prescriber TEXT, lot TEXT,
        qty INTEGER, days_supply INTEGER, status TEXT, auto_refill INTEGER DEFAULT 0, refills_left INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS ix_hist_pt ON med_history(patient_id, filled_on);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, type TEXT, payload TEXT);
      CREATE TABLE IF NOT EXISTS integrations (
        id TEXT PRIMARY KEY, partner TEXT, kind TEXT, status TEXT, scopes TEXT, key_prefix TEXT, key_hash TEXT, ip_allowlist TEXT,
        baa INTEGER DEFAULT 0, approved_by TEXT, purpose TEXT, created_at INTEGER, last_used INTEGER, rate_per_min INTEGER DEFAULT 120, note TEXT
      );
      CREATE TABLE IF NOT EXISTS api_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, integration_id TEXT, surface TEXT, method TEXT, path TEXT, tool TEXT,
        status INTEGER, latency_ms INTEGER, args_hash TEXT, denied TEXT
      );
      CREATE TABLE IF NOT EXISTS webhooks (id INTEGER PRIMARY KEY AUTOINCREMENT, integration_id TEXT, url TEXT, secret TEXT, events TEXT, active INTEGER DEFAULT 1);
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT, webhook_id INTEGER, event_id INTEGER, attempt INTEGER, status TEXT, http_status INTEGER, signature TEXT, at INTEGER, next_at INTEGER, error TEXT
      );
      CREATE TABLE IF NOT EXISTS outreach_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, recall_id TEXT, patient_id TEXT, notification_id INTEGER, attempt INTEGER DEFAULT 1, outcome TEXT,
        script TEXT, audio_id TEXT, voice TEXT, placed_at INTEGER, window_ok INTEGER, transfer INTEGER DEFAULT 0, callback_at INTEGER, note TEXT
      );
      CREATE TABLE IF NOT EXISTS oauth_tokens (token_hash TEXT PRIMARY KEY, integration_id TEXT, scopes TEXT, expires INTEGER, created INTEGER);
      CREATE TABLE IF NOT EXISTS webhook_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, event TEXT, verified INTEGER, body TEXT);
      CREATE TABLE IF NOT EXISTS audio (id TEXT PRIMARY KEY, mime TEXT, bytes BLOB, voice TEXT, text TEXT, at INTEGER);
    `);
    const addColumn = (table: string, col: string, def: string) => {
      const have = (this.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
      if (!have) this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    };
    addColumn("audit", "prev_hash", "TEXT");
    addColumn("audit", "hash", "TEXT");
    addColumn("audit", "reason", "TEXT");
    addColumn("prescriptions", "days_supply", "INTEGER");
    addColumn("prescriptions", "version", "INTEGER DEFAULT 0");
    addColumn("prescriptions", "parent_rx", "TEXT");
    addColumn("prescriptions", "review", "TEXT DEFAULT 'none'");
    addColumn("prescriptions", "review_note", "TEXT");
    addColumn("patients", "conditions", "TEXT DEFAULT ''");
    addColumn("patients", "tz_offset", "INTEGER DEFAULT -5");
    addColumn("patients", "voice_consent", "INTEGER DEFAULT 1");
    addColumn("patients", "dnc", "INTEGER DEFAULT 0");
  }

  /** Wipe every table (used by the demo reset). */
  clearAll() {
    const tables = this.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    this.raw.exec("PRAGMA foreign_keys = OFF");
    for (const t of tables) this.raw.exec(`DELETE FROM ${t.name}`);
    this.raw.exec("DELETE FROM sqlite_sequence");
    this.raw.exec("PRAGMA foreign_keys = ON");
  }
}
