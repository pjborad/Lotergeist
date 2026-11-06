const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

/** Ordered most-specific first so the sticky matcher picks the longest form. */
export const DATE_PATTERNS: RegExp[] = [
  new RegExp(`${MONTH_RE}-\\d{1,2}-(?:\\d{4}|\\d{2})(?!\\d)`, "iy"),
  new RegExp(`${MONTH_RE}-(?:\\d{4}|\\d{2})(?![\\d-])`, "iy"),
  new RegExp(`${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}`, "iy"),
  /\d{4}-\d{2}-\d{2}/y,
  /\d{1,2}\/\d{1,2}\/\d{4}/y,
  /\d{1,2}\/\d{1,2}\/\d{2}(?!\d)/y,
  new RegExp(`${MONTH_RE}\\.?,?\\s+\\d{4}`, "iy"),
  /\d{1,2}\/\d{4}/y,
  /\d{4}-\d{2}(?!\d)/y,
  /\d{1,2}\/\d{2}(?![\d\/])/y
];

const pad = (n: number) => String(n).padStart(2, "0");
const validMonth = (m: number) => m >= 1 && m <= 12;

/** Normalise a date expression to ISO. Month-only dates return YYYY-MM. */
export function toIsoDate(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return validMonth(+m[2]!) ? s : null;
  if ((m = /^(\d{4})-(\d{2})$/.exec(s))) return validMonth(+m[2]!) ? s : null;

  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})$/.exec(s))) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return validMonth(+m[1]!) && +m[2]! >= 1 && +m[2]! <= 31 ? `${y}-${pad(+m[1]!)}-${pad(+m[2]!)}` : null;
  }
  if ((m = /^(\d{1,2})\/(\d{4}|\d{2})$/.exec(s))) {
    const y = m[2]!.length === 2 ? 2000 + +m[2]! : +m[2]!;
    return validMonth(+m[1]!) ? `${y}-${pad(+m[1]!)}` : null;
  }
  if ((m = /^([A-Za-z]+)-(\d{1,2})-(\d{4}|\d{2})$/.exec(s))) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    return mi >= 0 ? `${y}-${pad(mi + 1)}-${pad(+m[2]!)}` : null;
  }
  if ((m = /^([A-Za-z]+)-(\d{4}|\d{2})$/.exec(s))) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    const y = m[2]!.length === 2 ? 2000 + +m[2]! : +m[2]!;
    return mi >= 0 ? `${y}-${pad(mi + 1)}` : null;
  }
  if ((m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    return mi >= 0 ? `${m[3]}-${pad(mi + 1)}-${pad(+m[2]!)}` : null;
  }
  if ((m = /^([A-Za-z]+)\.?,?\s+(\d{4})$/.exec(s))) {
    const mi = MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase());
    return mi >= 0 ? `${m[2]}-${pad(mi + 1)}` : null;
  }
  return null;
}

/** Try to read a date expression starting exactly at `pos`. */
export function dateAt(text: string, pos: number): { raw: string; iso: string; end: number } | null {
  for (const re of DATE_PATTERNS) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (m) {
      const iso = toIsoDate(m[0]);
      if (iso) return { raw: m[0], iso, end: pos + m[0].length };
    }
  }
  return null;
}
