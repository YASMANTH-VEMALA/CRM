/**
 * Pure spreadsheet helpers — no Node or Next.js dependencies, so the import
 * validators that build on them stay unit-testable outside a request.
 * ExcelJS-backed reading/writing lives in `@/lib/excel`.
 */

export type ParsedSheet = {
  headers: string[];
  rows: Array<Record<string, string>>;
};

export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

/** Parses CSV text, honouring quoted fields and embedded newlines. */
export function parseCsv(text: string): ParsedSheet {
  const lines = splitCsvLines(text).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitCsvRow(lines[0]).map(normaliseHeader);
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvRow(line);
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });

  return { headers: headers.filter(Boolean), rows };
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      lines.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/** Parses a spreadsheet number cell, tolerating thousands separators. */
export function parseSheetNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const cleaned = value.replace(/[,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Trims a spreadsheet text cell, treating blanks as absent. */
export function parseSheetText(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}
