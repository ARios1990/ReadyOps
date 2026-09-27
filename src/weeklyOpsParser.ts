// Client-side parser for weekly workforce report uploads.
// Supports CSV, TSV, plain text, XLSX/XLS (via xlsx), and text-based PDFs
// (via pdfjs-dist). All parsing runs in the browser — file bytes are never
// sent over the network.

import * as XLSX from "xlsx";
import * as pdfjs from "pdfjs-dist";

(pdfjs.GlobalWorkerOptions as { workerSrc: string }).workerSrc =
  `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

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

async function readAsText(file: File): Promise<string> {
  return await file.text();
}

function detectDelimiter(sample: string): string {
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

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
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
  const us = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
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

/** Turn a parsed 2-D grid (header row on row 0) into a ParseResult. */
function gridToResult(grid: string[][]): ParseResult {
  if (grid.length === 0) {
    return {
      rows: [], detectedColumns: [], unmappedColumns: [], columnMap: {},
      warnings: [], errors: ["No rows were detected in the file after parsing."],
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
    header.forEach((h, i) => { raw[h] = cells[i] ?? ""; });
    const pick = (key: string): string => {
      const src = header.find((h) => columnMap[h] === key);
      return src ? (raw[src] ?? "") : "";
    };
    const roundInt = (v: string | null | number | undefined): number | null => {
      const n = typeof v === "string" ? toNumber(v) : v == null ? null : Number(v);
      return n == null || !Number.isFinite(n) ? null : Math.round(n);
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
      calls: roundInt(pick("calls")),
      appointments: roundInt(pick("appointments")),
      results: roundInt(pick("results")),
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
    warnings.push("No agent-name column recognized — imported rows will not be attributed to individual agents.");
  }
  return {
    rows, detectedColumns: header, unmappedColumns: unmapped, columnMap,
    warnings, errors: [], formatSupported: true,
  };
}

async function parseCsvLike(file: File): Promise<ParseResult> {
  const text = await readAsText(file);
  if (!text.trim()) {
    return {
      rows: [], detectedColumns: [], unmappedColumns: [], columnMap: {},
      warnings: [], errors: ["The file appears to be empty."], formatSupported: true,
    };
  }
  const delimiter = detectDelimiter(text);
  const grid = parseDelimited(text, delimiter);
  return gridToResult(grid);
}

async function parseXlsx(file: File): Promise<ParseResult> {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) {
      return {
        rows: [], detectedColumns: [], unmappedColumns: [], columnMap: {},
        warnings: [], errors: ["Workbook contains no sheets."], formatSupported: true,
      };
    }
    const sheet = wb.Sheets[firstSheetName];
    const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1, defval: "", raw: false, blankrows: false,
    }) as unknown[][];
    const grid: string[][] = aoa
      .map((row) => row.map((cell) => (cell == null ? "" : String(cell))))
      .filter((row) => row.some((c) => c.trim().length > 0));
    const result = gridToResult(grid);
    const extraSheets = wb.SheetNames.slice(1);
    if (extraSheets.length > 0) {
      result.warnings.unshift(
        `Only the first sheet ("${firstSheetName}") was imported. Other sheets ignored: ${extraSheets.join(", ")}.`,
      );
    }
    return result;
  } catch (e) {
    return {
      rows: [], detectedColumns: [], unmappedColumns: [], columnMap: {},
      warnings: [],
      errors: [`Failed to read the Excel file: ${e instanceof Error ? e.message : String(e)}`],
      formatSupported: true,
      guidance: "The file may be password-protected or use an unusual format. Try Save-As → CSV or a newer .xlsx and re-upload.",
    };
  }
}

type PdfTextItem = { str: string; transform: number[]; hasEOL?: boolean };

async function parsePdf(file: File): Promise<ParseResult> {
  try {
    const buf = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
    const pdf = await loadingTask.promise;
    const allLines: { y: number; items: { x: number; str: string }[] }[] = [];
    let totalChars = 0;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const items = content.items as PdfTextItem[];
      const linesForPage = new Map<number, { x: number; str: string }[]>();
      for (const it of items) {
        if (!it.str) continue;
        totalChars += it.str.length;
        const x = it.transform[4];
        const y = Math.round(it.transform[5]);
        if (!linesForPage.has(y)) linesForPage.set(y, []);
        linesForPage.get(y)!.push({ x, str: it.str });
      }
      const sortedYs = [...linesForPage.keys()].sort((a, b) => b - a);
      for (const y of sortedYs) {
        const line = linesForPage.get(y)!;
        line.sort((a, b) => a.x - b.x);
        allLines.push({ y, items: line });
      }
    }
    if (totalChars === 0) {
      return {
        rows: [], detectedColumns: [], unmappedColumns: [], columnMap: {},
        warnings: [],
        errors: ["This PDF contains no extractable text — it looks like a scanned or image-only document."],
        formatSupported: true,
        guidance: "Please export the source report as CSV or XLSX, or run OCR on the PDF to produce a text-searchable version, and upload again.",
      };
    }
    // Convert grouped lines to tabular rows by splitting on wide x-gaps.
    const rowsAsCells: string[][] = allLines.map(({ items }) => {
      const cells: string[] = [];
      let cur = "";
      let prevEnd: number | null = null;
      for (const it of items) {
        if (prevEnd != null && it.x - prevEnd > 8) {
          cells.push(cur.trim());
          cur = it.str;
        } else {
          cur = cur ? `${cur} ${it.str}` : it.str;
        }
        prevEnd = it.x + it.str.length * 4;
      }
      if (cur) cells.push(cur.trim());
      return cells;
    }).filter((r) => r.some((c) => c.length > 0));
    if (rowsAsCells.length < 2) {
      return {
        rows: [], detectedColumns: [], unmappedColumns: [], columnMap: {},
        warnings: [],
        errors: ["Could not detect a tabular layout in the PDF."],
        formatSupported: true,
        guidance: "This heuristic works best on PDFs that render a table with aligned columns. Re-export as CSV or XLSX for reliable results.",
      };
    }
    const headerRow = rowsAsCells.find((r) => r.some((c) => matchKey(c) != null));
    const grid = headerRow
      ? [headerRow, ...rowsAsCells.slice(rowsAsCells.indexOf(headerRow) + 1).filter((r) => r.length >= Math.max(2, headerRow.length - 1))]
      : rowsAsCells;
    const result = gridToResult(grid);
    if (!headerRow) {
      result.warnings.unshift(
        "PDF header row could not be confidently identified — column mapping used the first non-empty line. If results look wrong, please re-upload the CSV or XLSX version.",
      );
    }
    if (Object.keys(result.columnMap).length === 0) {
      result.warnings.push(
        "None of the PDF columns matched known workforce headers. Consider uploading a CSV/XLSX export instead.",
      );
    }
    return result;
  } catch (e) {
    return {
      rows: [], detectedColumns: [], unmappedColumns: [], columnMap: {},
      warnings: [],
      errors: [`Failed to read the PDF: ${e instanceof Error ? e.message : String(e)}`],
      formatSupported: true,
      guidance: "If the PDF is encrypted or image-only, export the source report as CSV or XLSX and upload that instead.",
    };
  }
}

export async function parseWorkforceReport(file: File): Promise<ParseResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".xlsb") ||
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel") {
    return await parseXlsx(file);
  }
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return await parsePdf(file);
  }
  return await parseCsvLike(file);
}
