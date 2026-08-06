import { NextRequest } from "next/server";
import { getCurrentEmployee } from "@/lib/dal";
import { excelResponseHeaders } from "@/lib/excel";
import { isImportKind } from "@/lib/imports/columns";
import { buildTemplateWorkbook } from "@/lib/imports/templates";

/** Serves the blank Excel import template for products, opening stock or inward. */
export async function GET(request: NextRequest) {
  const employee = await getCurrentEmployee();
  if (!employee) {
    return new Response("Not signed in.", { status: 401 });
  }

  const kind = request.nextUrl.searchParams.get("kind") ?? "products";
  if (!isImportKind(kind)) {
    return new Response("Unknown template.", { status: 404 });
  }

  const permission = kind === "products" ? "import_products" : "create_stock_inward";
  if (!employee.permissions.includes(permission)) {
    return new Response("You do not have permission to download this template.", { status: 403 });
  }

  const buffer = await buildTemplateWorkbook(kind);
  return new Response(new Uint8Array(buffer), {
    headers: excelResponseHeaders(`${kind.replace("_", "-")}-template.xlsx`),
  });
}
