import "server-only";
import { buildWorkbook } from "@/lib/excel";
import { TEMPLATES, type ImportKind } from "./columns";

export { TEMPLATES, isImportKind, type ImportKind, type TemplateColumn } from "./columns";

/**
 * Builds the downloadable template: the header row plus one example row that
 * doubles as inline documentation for each column.
 */
export async function buildTemplateWorkbook(kind: ImportKind): Promise<Buffer> {
  const template = TEMPLATES[kind];
  const required = template.columns.filter((column) => column.required).map((column) => column.header);

  return buildWorkbook(
    template.title,
    template.columns.map((column) => ({ header: column.header, key: column.key, width: column.width })),
    [Object.fromEntries(template.columns.map((column) => [column.key, column.hint]))],
    {
      title: template.title,
      meta: [
        ["Required columns", required.join(", ")],
        ["Instructions", "Replace the example row below with your own data. Keep the header row unchanged."],
      ],
    }
  );
}
