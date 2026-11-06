import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { sgtinDigitalLink } from "@bsrx/gs1";
import type {
  CustodyStep, EpcisEvent, LotTrace, Party, PharmacyTrace, SerialRow, StageTrace, TraceFilter, TraceResult
} from "./types";

const COLS = ["event_id", "type", "biz_step", "event_time", "epc", "gtin", "serial", "lot", "expiry", "read_point", "biz_location", "owner_gln", "source_gln", "dest_gln", "origin", "meta"] as const;

const placeholders = (start: number, n: number) => Array.from({ length: n }, (_, i) => `$${start + i}`).join(",");

/** The "crypt": EPCIS events in a DuckDB file, with a flattened `serials` view. */
export class CryptStore {
  private constructor(private conn: DuckDBConnection, readonly path: string) {}

  static async open(path = ":memory:"): Promise<CryptStore> {
    const inst = await DuckDBInstance.create(path);
    const store = new CryptStore(await inst.connect(), path);
    await store.init();
    return store;
  }

  private async init() {
    await this.conn.run(`CREATE TABLE IF NOT EXISTS events (
      event_id VARCHAR, type VARCHAR, biz_step VARCHAR, event_time VARCHAR, epc VARCHAR,
      gtin VARCHAR, serial VARCHAR, lot VARCHAR, expiry VARCHAR, read_point VARCHAR,
      biz_location VARCHAR, owner_gln VARCHAR, source_gln VARCHAR, dest_gln VARCHAR,
      origin VARCHAR, meta VARCHAR)`);
    await this.conn.run(`CREATE TABLE IF NOT EXISTS parties (
      gln VARCHAR PRIMARY KEY, name VARCHAR, kind VARCHAR, lat DOUBLE, lon DOUBLE,
      system VARCHAR, code VARCHAR, address VARCHAR)`);
    await this.conn.run(`CREATE OR REPLACE VIEW serials AS
      SELECT gtin, serial,
             any_value(lot) AS lot, any_value(expiry) AS expiry,
             arg_max(owner_gln, event_time) AS current_owner,
             arg_max(read_point, event_time) AS current_location,
             arg_max(biz_location, event_time) AS current_shelf,
             arg_max(biz_step, event_time) AS last_biz_step,
             max(event_time) AS last_event_time
      FROM events GROUP BY gtin, serial`);
  }

  async rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.conn.runAndReadAll(sql, params as never);
    return r.getRowObjectsJson() as unknown as T[];
  }

  async scalar(sql: string, params: unknown[] = []): Promise<number> {
    const r = await this.rows<Record<string, string | number>>(sql, params);
    return Number(Object.values(r[0] ?? { n: 0 })[0] ?? 0);
  }

  async close() {
    this.conn.closeSync();
  }

  // ---------- writes ----------

  async replaceParties(parties: Party[]) {
    await this.conn.run("DELETE FROM parties");
    for (const p of parties) {
      await this.conn.run(
        "INSERT INTO parties VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [p.gln, p.name, p.kind, p.lat ?? null, p.lon ?? null, p.system ?? null, p.code ?? null, p.address ?? null] as never
      );
    }
  }

  /** Bulk insert through the DuckDB appender. */
  async insertEvents(events: Iterable<EpcisEvent>): Promise<number> {
    const ap = await this.conn.createAppender("events");
    let n = 0;
    for (const e of events) {
      const v = [e.eventId, e.type, e.bizStep, e.eventTime, e.epc, e.gtin, e.serial, e.lot, e.expiry, e.readPoint, e.bizLocation, e.ownerGln, e.sourceGln, e.destGln, e.origin, e.meta];
      for (const x of v) ap.appendVarchar(x);
      ap.endRow();
      n++;
    }
    ap.flushSync();
    ap.closeSync();
    return n;
  }

  /** Forget RPA-written dispensing events for these packages (a re-run of the hunt starts clean). */
  async deleteDispensesFor(gtins: string[], lots: string[]) {
    if (!gtins.length) return;
    const lotsUp = lots.map((l) => l.replace(/\s+/g, "").toUpperCase());
    const lotClause = lotsUp.length ? ` AND upper(lot) IN (${placeholders(gtins.length + 1, lotsUp.length)})` : "";
    await this.conn.run(`DELETE FROM events WHERE origin = 'rpa' AND gtin IN (${placeholders(1, gtins.length)})${lotClause}`, [...gtins, ...lotsUp] as never);
  }

  async deleteEventsByOrigin(origin: "epcis" | "rpa") {
    await this.conn.run("DELETE FROM events WHERE origin = $1", [origin] as never);
  }

  /** RPA-4: dispense rows become EPCIS dispensing ObjectEvents. */
  makeDispenseEvent(p: { gtin: string; serial: string; lot: string; expiry: string; pharmacyGln: string; eventTime: string; rxNumber: string; patientId: string; source: "rxterm" | "fax"; serialInferred: boolean }): EpcisEvent {
    return {
      eventId: `urn:uuid:disp-${p.pharmacyGln}-${p.rxNumber}-${p.serial}`,
      type: "ObjectEvent",
      bizStep: "dispensing",
      eventTime: p.eventTime,
      epc: sgtinDigitalLink(p.gtin, p.serial),
      gtin: p.gtin, serial: p.serial, lot: p.lot, expiry: p.expiry,
      readPoint: p.pharmacyGln, bizLocation: "", ownerGln: "", sourceGln: p.pharmacyGln, destGln: "",
      origin: "rpa",
      meta: JSON.stringify({ rxNumber: p.rxNumber, patientId: p.patientId, source: p.source, serialInferred: p.serialInferred })
    };
  }

  /** Idempotent append: skips events whose id already exists. */
  async appendEvents(events: EpcisEvent[]): Promise<number> {
    if (!events.length) return 0;
    const ids = events.map((e) => e.eventId);
    const have = new Set((await this.rows<{ event_id: string }>(`SELECT event_id FROM events WHERE event_id IN (${placeholders(1, ids.length)})`, ids)).map((r) => r.event_id));
    const fresh = events.filter((e) => !have.has(e.eventId));
    return this.insertEvents(fresh);
  }

  // ---------- reads ----------

  async parties(): Promise<Party[]> {
    const r = await this.rows<Record<string, string | number | null>>("SELECT * FROM parties ORDER BY kind, name");
    return r.map((x) => ({
      gln: String(x.gln), name: String(x.name), kind: x.kind as Party["kind"],
      lat: x.lat == null ? undefined : Number(x.lat), lon: x.lon == null ? undefined : Number(x.lon),
      system: (x.system ?? undefined) as Party["system"], code: (x.code ?? undefined) as string | undefined,
      address: (x.address ?? undefined) as string | undefined
    }));
  }

  async countEvents(): Promise<number> {
    return this.scalar("SELECT CAST(count(*) AS INTEGER) FROM events");
  }

  private serialWhere(f: TraceFilter, alias = "s") {
    const gt = f.gtins.length ? `${alias}.gtin IN (${placeholders(1, f.gtins.length)})` : "FALSE";
    const lotStart = f.gtins.length + 1;
    const lt = f.lots.length ? `upper(${alias}.lot) IN (${placeholders(lotStart, f.lots.length)})` : "TRUE";
    return { where: `${gt} AND ${lt}`, params: [...f.gtins, ...f.lots.map((l) => l.replace(/\s+/g, "").toUpperCase())] };
  }

  async serialsFor(f: TraceFilter): Promise<SerialRow[]> {
    const { where, params } = this.serialWhere(f);
    const r = await this.rows<Record<string, string>>(`SELECT * FROM serials s WHERE ${where} ORDER BY lot, serial`, params);
    return r.map((x) => ({
      gtin: x.gtin!, serial: x.serial!, lot: x.lot!, expiry: x.expiry ?? "",
      currentOwner: x.current_owner ?? "", currentLocation: x.current_location ?? "", currentShelf: x.current_shelf ?? "",
      lastBizStep: x.last_biz_step as SerialRow["lastBizStep"], lastEventTime: x.last_event_time!
    }));
  }

  /** TRK-3: pharmacy receipts with no upstream shipping event to that pharmacy. */
  async findOrphans(f: TraceFilter): Promise<number> {
    const { where, params } = this.serialWhere(f, "r");
    return this.scalar(
      `SELECT CAST(count(*) AS INTEGER) FROM events r
       WHERE r.biz_step = 'receiving' AND ${where}
         AND r.owner_gln IN (SELECT gln FROM parties WHERE kind = 'pharmacy')
         AND NOT EXISTS (SELECT 1 FROM events s WHERE s.biz_step = 'shipping' AND s.gtin = r.gtin AND s.serial = r.serial
                           AND s.dest_gln = r.owner_gln AND s.event_time <= r.event_time)`,
      params
    );
  }

  /** TRK-1/TRK-2: everything we know about the given GTIN + lot combinations. */
  async trace(f: TraceFilter): Promise<TraceResult> {
    const t0 = performance.now();
    const { where, params } = this.serialWhere(f);
    const kinds = `(SELECT gln, kind FROM parties)`;

    const lotRows = await this.rows<Record<string, string | number>>(
      `SELECT s.lot, s.gtin, any_value(s.expiry) AS expiry, CAST(count(*) AS INTEGER) AS serials,
              CAST(sum(CASE WHEN k.kind = 'manufacturer' THEN 1 ELSE 0 END) AS INTEGER) AS at_mfr,
              CAST(sum(CASE WHEN k.kind = 'distributor' THEN 1 ELSE 0 END) AS INTEGER) AS at_dist,
              CAST(sum(CASE WHEN k.kind = 'pharmacy' AND s.last_biz_step = 'receiving' THEN 1 ELSE 0 END) AS INTEGER) AS on_shelf,
              CAST(sum(CASE WHEN s.last_biz_step = 'dispensing' THEN 1 ELSE 0 END) AS INTEGER) AS dispensed
       FROM serials s LEFT JOIN ${kinds} k ON k.gln = s.current_location
       WHERE ${where} GROUP BY s.lot, s.gtin ORDER BY s.lot`, params);
    const lots: LotTrace[] = lotRows.map((r) => ({
      lot: String(r.lot), gtin: String(r.gtin), expiry: String(r.expiry ?? ""), serials: Number(r.serials),
      atManufacturer: Number(r.at_mfr), atDistributor: Number(r.at_dist), onPharmacyShelf: Number(r.on_shelf), dispensed: Number(r.dispensed)
    }));

    // Pharmacy view. Received = ever received there; dispensed = has a dispensing event there.
    const phWhere = this.serialWhere(f, "r");
    const phRows = await this.rows<Record<string, string | number>>(
      `SELECT p.gln, p.name, p.system, p.code, p.lat, p.lon,
              CAST(count(DISTINCT r.gtin || '/' || r.serial) AS INTEGER) AS received
       FROM events r JOIN parties p ON p.gln = r.owner_gln AND p.kind = 'pharmacy'
       WHERE r.biz_step = 'receiving' AND ${phWhere.where}
       GROUP BY p.gln, p.name, p.system, p.code, p.lat, p.lon ORDER BY p.name`, phWhere.params);
    const shelfRows = await this.rows<Record<string, string | number>>(
      `SELECT s.current_owner AS gln, CAST(count(*) AS INTEGER) AS n FROM serials s
       WHERE ${where} AND s.last_biz_step = 'receiving' AND s.current_owner IN (SELECT gln FROM parties WHERE kind='pharmacy')
       GROUP BY s.current_owner`, params);
    const shelf = new Map(shelfRows.map((r) => [String(r.gln), Number(r.n)]));
    const pharmacies: PharmacyTrace[] = phRows.map((r) => {
      const onShelf = shelf.get(String(r.gln)) ?? 0;
      return {
        gln: String(r.gln), name: String(r.name), system: (r.system as "rxterm" | "fax") ?? "rxterm", code: String(r.code ?? ""),
        lat: Number(r.lat), lon: Number(r.lon), received: Number(r.received), onShelf, dispensed: Number(r.received) - onShelf
      };
    });

    // Stage cards for the Body Trail screen
    const stageRows = await this.rows<Record<string, string | number>>(
      `SELECT e.biz_step, CAST(count(DISTINCT e.gtin || '/' || e.serial) AS INTEGER) AS n,
              min(e.event_time) AS first, max(e.event_time) AS last,
              string_agg(DISTINCT p.name, ' | ') AS who
       FROM events e LEFT JOIN parties p ON p.gln = CASE WHEN e.biz_step = 'shipping' THEN e.source_gln ELSE e.owner_gln END
       JOIN serials s ON s.gtin = e.gtin AND s.serial = e.serial
       WHERE ${where} AND (e.biz_step <> 'receiving' OR p.kind = 'pharmacy')
         AND (e.biz_step <> 'shipping' OR p.kind = 'distributor')
       GROUP BY e.biz_step`, params);
    const order = ["commissioning", "shipping", "receiving", "dispensing"];
    const stages: StageTrace[] = stageRows
      .map((r) => ({ bizStep: r.biz_step as StageTrace["bizStep"], count: Number(r.n), firstDate: String(r.first).slice(0, 10), lastDate: String(r.last).slice(0, 10), who: String(r.who ?? "") }))
      .sort((a, b) => order.indexOf(a.bizStep) - order.indexOf(b.bizStep));
    const held = pharmacies.reduce((a, p) => a + p.onShelf, 0);
    stages.push({ bizStep: "shelf", count: held, firstDate: "", lastDate: "", who: "Quarantine" });

    const totalSerials = lots.reduce((a, l) => a + l.serials, 0);
    const orphans = await this.findOrphans(f);
    return { filter: f, totalSerials, orphans, lots, pharmacies, stages, ms: Math.round(performance.now() - t0) };
  }

  /** Chain of custody for one package, oldest first, with party names resolved. */
  async custody(gtin: string, serial: string): Promise<CustodyStep[]> {
    const r = await this.rows<Record<string, string>>(
      `SELECT e.*, p.name AS party_name FROM events e
       LEFT JOIN parties p ON p.gln = CASE WHEN e.biz_step = 'shipping' THEN e.source_gln WHEN e.biz_step = 'dispensing' THEN e.read_point ELSE e.owner_gln END
       WHERE e.gtin = $1 AND e.serial = $2 ORDER BY e.event_time`, [gtin, serial]);
    return r.map((x) => ({
      bizStep: x.biz_step as CustodyStep["bizStep"], eventTime: x.event_time!, partyName: x.party_name ?? "", location: x.read_point ?? "",
      shelf: x.biz_location ?? "", origin: x.origin as "epcis" | "rpa", meta: x.meta ? JSON.parse(x.meta) : {}
    }));
  }

  /** Packages of a lot that went to a given pharmacy, oldest receipt first (FIFO order). */
  async shelfSerials(f: TraceFilter, pharmacyGln?: string): Promise<SerialRow[]> {
    const { where, params } = this.serialWhere(f);
    const extra = pharmacyGln ? ` AND s.current_owner = $${params.length + 1}` : "";
    const r = await this.rows<Record<string, string>>(
      `SELECT s.* FROM serials s
       WHERE ${where} AND s.last_biz_step = 'receiving' AND s.current_owner IN (SELECT gln FROM parties WHERE kind='pharmacy')${extra}
       ORDER BY s.current_owner, s.lot, s.last_event_time, s.serial`, pharmacyGln ? [...params, pharmacyGln] : params);
    return r.map((x) => ({
      gtin: x.gtin!, serial: x.serial!, lot: x.lot!, expiry: x.expiry ?? "", currentOwner: x.current_owner!, currentLocation: x.current_location!,
      currentShelf: x.current_shelf ?? "", lastBizStep: x.last_biz_step as SerialRow["lastBizStep"], lastEventTime: x.last_event_time!
    }));
  }

  /** Every serial of a lot ever received at a pharmacy, in receipt order. Used to infer serials for dispenses. */
  async receivedSerials(f: TraceFilter, pharmacyGln: string): Promise<{ gtin: string; serial: string; lot: string; expiry: string; receivedAt: string; dispensed: boolean }[]> {
    const { where, params } = this.serialWhere(f);
    const r = await this.rows<Record<string, string | boolean>>(
      `SELECT s.gtin, s.serial, s.lot, s.expiry,
              (SELECT min(event_time) FROM events x WHERE x.gtin = s.gtin AND x.serial = s.serial AND x.biz_step = 'receiving' AND x.owner_gln = $${params.length + 1}) AS received_at,
              (s.last_biz_step = 'dispensing') AS dispensed
       FROM serials s
       WHERE ${where}
         AND EXISTS (SELECT 1 FROM events x WHERE x.gtin = s.gtin AND x.serial = s.serial AND x.biz_step = 'receiving' AND x.owner_gln = $${params.length + 1})
       ORDER BY received_at, s.serial`, [...params, pharmacyGln]);
    return r.map((x) => ({ gtin: String(x.gtin), serial: String(x.serial), lot: String(x.lot), expiry: String(x.expiry ?? ""), receivedAt: String(x.received_at), dispensed: x.dispensed === true || x.dispensed === "true" }));
  }
}
