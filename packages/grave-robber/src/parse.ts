/** Screen-scraping parsers shared by the terminal and the fax path. */

const TERM_ROW = /^(\d{4,8})\s+(S-\d{4})\s+(\d{2})\/(\d{2})\/(\d{2})\s+(\d+)\s+(\S+)\s*$/;

export interface ParsedRow { rxNumber: string; patientId: string; fillDate: string; qty: number; lot: string }

export function parseTerminalLine(line: string): ParsedRow | null {
  const m = TERM_ROW.exec(line.trim());
  if (!m) return null;
  return { rxNumber: m[1]!, patientId: m[2]!, fillDate: `20${m[5]}-${m[3]}-${m[4]}`, qty: Number(m[6]), lot: m[7]! };
}

const FAX_ROW = /^Rx\s+(\d{3,8})\s+(S-\d{4})\s+(\d{1,2})\/(\d{1,2})\s+#(\d+)\s*$/;

export interface FaxPage {
  pharmacyName: string;
  ndc: string;
  lot: string;
  runDate: string;
  rows: ParsedRow[];
  failedLines: number;
  confidence: number;
}

export function parseFaxText(text: string): FaxPage | null {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const title = lines.find((l) => /^Dispense Log/i.test(l));
  const prod = lines.find((l) => /^NDC:/i.test(l));
  const run = lines.find((l) => /^RUN DATE:/i.test(l));
  if (!title || !prod || !run) return null;
  const ndc = /NDC:\s*([\d-]+)/i.exec(prod)?.[1];
  const lot = /LOT:\s*(\S+)/i.exec(prod)?.[1];
  const rd = /RUN DATE:\s*(\d{2})\/(\d{2})\/(\d{2})/i.exec(run);
  if (!ndc || !lot || !rd) return null;
  const runYear = 2000 + Number(rd[3]);
  const rows: ParsedRow[] = [];
  let failed = 0;
  for (const l of lines) {
    if (!/^Rx\b/i.test(l)) continue;
    const m = FAX_ROW.exec(l);
    if (!m) { failed++; continue; }
    const mo = Number(m[3]); const da = Number(m[4]);
    // fax rows have no year: assume the run year, or the year before if that would be in the future
    let year = runYear;
    if (mo > Number(rd[1])) year -= 1;
    rows.push({ rxNumber: m[1]!, patientId: m[2]!, fillDate: `${year}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`, qty: Number(m[5]), lot });
  }
  const total = rows.length + failed;
  return {
    pharmacyName: title.replace(/^Dispense Log\s*-\s*/i, "").trim(), ndc, lot, runDate: `${runYear}-${rd[1]}-${rd[2]}`,
    rows, failedLines: failed, confidence: total === 0 ? 0 : Math.round((rows.length / total) * 100) / 100
  };
}
