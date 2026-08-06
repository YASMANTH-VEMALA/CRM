import "server-only";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { normaliseHeader, parseCsv, type ParsedSheet } from "@/lib/spreadsheet";

/**
 * ExcelJS-backed workbook reading and writing. Templates, imports and report
 * exports all go through here so every generated file has the same shape.
 * Pure helpers (header normalisation, CSV parsing) live in `@/lib/spreadsheet`
 * so the import validators stay testable outside a request.
 */

export type { ParsedSheet } from "@/lib/spreadsheet";
export { normaliseHeader } from "@/lib/spreadsheet";

export type SheetColumn = { header: string; key: string; width?: number };

export async function buildWorkbook(
  sheetName: string,
  columns: SheetColumn[],
  rows: Array<Record<string, unknown>>,
  options?: { title?: string; meta?: Array<[string, string]> }
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mars Pharmacy ERP";
  workbook.created = new Date();

  // Excel rejects sheet names over 31 characters or containing : \ / ? * [ ]
  const sheet = workbook.addWorksheet(sheetName.replace(/[:\\/?*[\]]/g, "-").slice(0, 31));

  let headerRowIndex = 1;
  if (options?.title) {
    sheet.addRow([options.title]);
    sheet.getRow(1).font = { bold: true, size: 14 };
    headerRowIndex += 1;
  }
  for (const [label, value] of options?.meta ?? []) {
    sheet.addRow([label, value]);
    headerRowIndex += 1;
  }
  if (options?.title || options?.meta?.length) {
    sheet.addRow([]);
    headerRowIndex += 1;
  }

  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? Math.max(14, column.header.length + 4),
  }));

  // Assigning `columns` writes headers to row 1; when a title block is present
  // the real header row has to be moved down to sit above the data.
  if (headerRowIndex > 1) {
    sheet.spliceRows(1, 1);
    sheet.insertRow(headerRowIndex, columns.map((c) => c.header));
  }

  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEFEFEF" },
  };

  for (const row of rows) {
    sheet.addRow(columns.map((column) => row[column.key] ?? ""));
  }

  sheet.autoFilter = {
    from: { row: headerRowIndex, column: 1 },
    to: { row: headerRowIndex, column: columns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Reads the first worksheet of an .xlsx/.csv upload into plain string cells.
 * Header matching is case-insensitive and ignores surrounding whitespace.
 */
export async function parseSpreadsheet(file: File): Promise<ParsedSheet> {
  const buffer = Buffer.from(await file.arrayBuffer());

  if (file.name.toLowerCase().endsWith(".csv")) {
    return parseCsv(buffer.toString("utf8"));
  }

  const workbook = new ExcelJS.Workbook();
  // ExcelJS types `load` against an older Buffer signature; the runtime only
  // needs the bytes.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers: string[] = [];
  const headerRow = sheet.getRow(1);
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = normaliseHeader(cellText(cell.value));
  });

  const rows: Array<Record<string, string>> = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = cellText(row.getCell(index + 1).value);
      record[header] = value;
      if (value) hasValue = true;
    });
    if (hasValue) rows.push(record);
  });

  return { headers: headers.filter(Boolean), rows };
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return String(value.result ?? "").trim();
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
    return "";
  }
  return String(value).trim();
}

export function hashFile(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function excelResponseHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}
