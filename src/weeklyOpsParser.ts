// Client-side parser for weekly workforce report uploads.
// Supports CSV, TSV, plain text (delimited); XLSX/XLS/PDF are rejected with a
// clear message so the user can convert and retry. Nothing is sent to the
// network — all parsing runs in the browser.

export type ParsedRow = {
  agent_name: string | null;
  team_name: string | null;
  entry_date: string | null;
  day_of_week: string | null;
  scheduled_hours: number | null;
  actual_hours: number | null;
  productive_hours: number | null;
  idle_hours: number | null;
  break_hours: number | null;
  calls: number | null;
  appointments: number | null;
  results: number | null;
  login_at: string | null;
  logout_at: string | null;
  status: string | null;
  raw: Record<string, string>;
};

export type ParseResult = {
  rows: ParsedRow[];
  detectedColumns: string[];
  unmappedColumns: string[];
  columnMap: Record<string, string>;
  warnings: string[];
  errors: string[];
  formatSupported: boolean;
  guidance?: string;
};

const KEY_ALIASES: Record<string, RegExp[]> = {
  agent_name: [/^agent(\s|_)?(name|id)?$/i, /^rep(\s|_)?name$/i, /^user(\s|_)?name$/i, /^employee$/i, /^name$/i, /^first(\s|_)?last$/i],
  team_name: [/^team$/i, /^team(\s|_)?name$/i, /^group$/i, /^department$/i, /^supervisor$/i, /^manager$/i],
  entry_date: [/^date$/i, /^day$/i, /^work(\s|_)?date$/i, /^shift(\s|_)?date$/i, /^report(\s|_)?date$/i],
  day_of_week: [/^weekday$/i, /^day(\s|_)?of(\s|_)?week$/i, /^dow$/i],
  scheduled_hours: [/^sched(uled)?(\s|_)?hours?$/i, /^planned(\s|_)?hours?$/i, /^shift(\s|_)?hours?$/i],
  actual_hours: [/^actual(\s|_)?hours?$/i, /^logged(\s|_)?hours?$/i, /^worked(\s|_)?hours?$/i, /^attend(ed|ance)?(\s|_)?hours?$/i, /^time(\s|_)?on(\s|_)?system$/i],
  productive_hours: [/^productive(\s|_)?hours?$/i, /^talk(\s|_)?time$/i, /^on(\s|_)?call(\s|_)?hours?$/i, /^prod(\s|_)?hours?$/i],
  idle_hours: [/^idle(\s|_)?hours?$/i, /^idle(\s|_)?time$/i, /^waiting$/i, /^available(\s|_)?time$/i],
  break_hours: [/^break(\s|_)?hours?$/i, /^breaks?$/i, /^pause(\s|_)?time$/i],
  calls: [/^calls?$/i, /^total(\s|_)?calls?$/i, /^dials?$/i, /^calls(\s|_)?made$/i, /^connects?$/i],
  appointments: [/^appointments?$/i, /^appts?$/i, /^bookings?$/i, /^scheduled(\s|_)?apps?$/i],
  results: [/^results?$/i, /^leads?$/i, /^sales?$/i, /^conversions?$/i, /^outcomes?$/i],
  login_at: [/^login(\s|_)?(at|time)?$/i, /^first(\s|_)?login$/i, /^clock(\s|_)?in$/i, /^start(\s|_)?time$/i],
  logout_at: [/^logout(\s|_)?(at|time)?$/i, /^last(\s|_)?logout$/i, /^clock(\s|_)?out$/i, /^end(\s|_)?time$/i],
  status: [/^status$/i, /^state$/i, /^attendance$/i],
};

/** Read the file as text, safely trapping any binary/format issues. */
export async function readAsText(file: File): Promise<string> {
  return await file.text();
}

/** Detect the delimiter of a text sample. */
export function detectDelimiter(sample: string): string {
  const line = sample.split(/\r?\n/).find((row) => row.trim().length > 0) || "";
  const candidates: [string, number][] = [
    [",", (line.match(/,/g) || []).length],
    ["\t", (line.match(/\t/g) || []).length],
    [";", (line.match(/;/g) || []).length],
    ["|", (line.match(/\|/g) || []).length],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][1] > 0 ? candidates[0][0] : ",";
}

/** RFC-4180-ish CSV/TSV/DSV parser: handles quoted fields, escaped quotes, CRLF. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

function normalizeHeader(h: string): string {
  return h.trim().replace(/\s+/g, " ");
}

function matchKey(header: string): string | null {
  const norm = header.trim();
  for (const [key, patterns] of Object.entries(KEY_ALIASES)) {
    if (patterns.some((p) => p.test(norm))) return key;
  }
  return null;
}

function toNumber(value: string): number | null {
  if (value == null) return null;
  const cleaned = value.replace(/[$,%\s]/g, "").replace(/,/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const asDur = parseDuration(value);
  if (asDur != null) return asDur;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDuration(value: string): number | null {
  // Accept "H:MM" or "HH:MM:SS" clock-style durations and return decimal hours.
  const m = value.trim().match(/^(\d{1,3}):([0-5]?\d)(?::([0-5]?\d))?$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours + minutes / 60 + seconds / 3600;
}

function toIsoDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    let yyyy = us[3];
    if (yyyy.length === 2) yyyy = (Number(yyyy) > 50 ? "19" : "20") + yyyy;
    return `${yyyy}-${mm}-${dd}`;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return null;
}

function toIsoTimestamp(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  const timeOnly = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (timeOnly) {
    const today = new Date();
    let h = Number(timeOnly[1]);
    const m = Number(timeOnly[2]);
    const s = timeOnly[3] ? Number(timeOnly[3]) : 0;
    const ampm = timeOnly[4]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    return new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m, s).toISOString();
  }
  return null;
}

/** Main entry point. Rejects binary formats with clear guidance. */
export async function parseWorkforceReport(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  const isBinary =
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsb") ||
    name.endsWith(".pdf") ||
    file.type === "application/pdf" ||
    file.type.startsWith("application/vnd.");
  if (isBinary) {
    return {
      rows: [],
      detectedColumns: [],
      unmappedColumns: [],
      columnMap: {},
      warnings: [],
      errors: [
        `The ${name.split(".").pop()?.toUpperCase() || "binary"} format cannot be parsed reliably in the browser without a specialized library that is not installed here.`,
      ],
      formatSupported: false,
      guidance:
        "Please export or Save-As to CSV or a tab-delimited TXT file (in Excel: File → Save As → CSV UTF-8 or Text). Column headers on the first row work best. Then upload again.",
    };
  }
  const text = await readAsText(file);
  if (!text.trim()) {
    return {
      rows: [],
      detectedColumns: [],
      unmappedColumns: [],
      columnMap: {},
      warnings: [],
      errors: ["The file appears to be empty."],
      formatSupported: true,
    };
  }
  const delimiter = detectDelimiter(text);
  const grid = parseDelimited(text, delimiter);
  if (grid.length === 0) {
    return {
      rows: [],
      detectedColumns: [],
      unmappedColumns: [],
      columnMap: {},
      warnings: [],
      errors: ["No rows were detected in the file after parsing."],
      formatSupported: true,
    };
  }
  const header = grid[0].map(normalizeHeader);
  const dataRows = grid.slice(1);
  const columnMap: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const h of header) {
    const key = matchKey(h);
    if (key) columnMap[h] = key;
    else unmapped.push(h);
  }
  const rows: ParsedRow[] = [];
  const warnings: string[] = [];
  for (let r = 0; r < dataRows.length; r += 1) {
    const cells = dataRows[r];
    const raw: Record<string, string> = {};
    header.forEach((h, i) => {
      raw[h] = cells[i] ?? "";
    });
    const pick = (key: string): string => {
      const src = header.find((h) => columnMap[h] === key);
      return src ? (raw[src] ?? "") : "";
    };
    const row: ParsedRow = {
      agent_name: pick("agent_name").trim() || null,
      team_name: pick("team_name").trim() || null,
      entry_date: toIsoDate(pick("entry_date")),
      day_of_week: pick("day_of_week").trim() || null,
      scheduled_hours: toNumber(pick("scheduled_hours")),
      actual_hours: toNumber(pick("actual_hours")),
      productive_hours: toNumber(pick("productive_hours")),
      idle_hours: toNumber(pick("idle_hours")),
      break_hours: toNumber(pick("break_hours")),
      calls: (() => {
        const n = toNumber(pick("calls"));
        return n == null ? null : Math.round(n);
      })(),
      appointments: (() => {
        const n = toNumber(pick("appointments"));
        return n == null ? null : Math.round(n);
      })(),
      results: (() => {
        const n = toNumber(pick("results"));
        return n == null ? null : Math.round(n);
      })(),
      login_at: toIsoTimestamp(pick("login_at")),
      logout_at: toIsoTimestamp(pick("logout_at")),
      status: pick("status").trim() || null,
      raw,
    };
    if (!row.agent_name && !row.team_name && !row.calls && !row.actual_hours) {
      warnings.push(`Row ${r + 2}: skipped (no agent, team, hours, or calls detected).`);
      continue;
    }
    rows.push(row);
  }
  if (!Object.values(columnMap).includes("agent_name")) {
    warnings.push(
      "No agent-name column recognized — imported rows will not be attributed to individual agents.",
    );
  }
  return {
    rows,
    detectedColumns: header,
    unmappedColumns: unmapped,
    columnMap,
    warnings,
    errors: [],
    formatSupported: true,
  };
}
