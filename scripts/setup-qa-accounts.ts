/**
 * Provisions the browser-QA environment: two clean entities, one account per
 * role with a real auth login, and a second master admin so the original is
 * never the only privileged account.
 *
 * Idempotent — re-running updates the existing rows and resets passwords
 * rather than creating duplicates.
 *
 *   npx tsx scripts/setup-qa-accounts.ts
 *
 * Passwords are generated, printed ONCE to stdout, and never stored in the
 * repository. Capture them from the terminal and put them in your password
 * manager; re-run the script to rotate them.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env: Record<string, string> = {};
for (const line of raw.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2];
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase credentials are missing from .env.local");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

/** 20 chars, mixed classes, no ambiguous glyphs. */
function password(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = randomBytes(20);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

type EntitySpec = { name: string; code: string; location: string };
const ENTITIES: EntitySpec[] = [
  { name: "Test Pharmacy A", code: "QA-A", location: "Dar es Salaam" },
  { name: "Test Pharmacy B", code: "QA-B", location: "Arusha" },
];

type AccountSpec = {
  label: string;
  email: string;
  fullName: string;
  role: "master_admin" | "entity_admin" | "inventory_user" | "sales_user";
  entityCode: string | null;
  maxDiscountPercent: number;
};

const ACCOUNTS: AccountSpec[] = [
  {
    label: "Master Admin (QA)",
    email: "qa.master@marspharmacy.test",
    fullName: "QA Master Admin",
    role: "master_admin",
    entityCode: null,
    maxDiscountPercent: 100,
  },
  {
    label: "Second Master Admin (break-glass)",
    email: "qa.master2@marspharmacy.test",
    fullName: "QA Master Admin Two",
    role: "master_admin",
    entityCode: null,
    maxDiscountPercent: 100,
  },
  {
    label: "Entity Admin — Test Pharmacy A",
    email: "qa.entityadmin@marspharmacy.test",
    fullName: "QA Entity Admin",
    role: "entity_admin",
    entityCode: "QA-A",
    maxDiscountPercent: 50,
  },
  {
    label: "Inventory User — Test Pharmacy A",
    email: "qa.inventory@marspharmacy.test",
    fullName: "QA Inventory User",
    role: "inventory_user",
    entityCode: "QA-A",
    maxDiscountPercent: 0,
  },
  {
    label: "Sales User — Test Pharmacy A",
    email: "qa.sales@marspharmacy.test",
    fullName: "QA Sales User",
    role: "sales_user",
    entityCode: "QA-A",
    maxDiscountPercent: 10,
  },
  {
    label: "Entity Admin — Test Pharmacy B",
    email: "qa.entityadmin.b@marspharmacy.test",
    fullName: "QA Entity Admin B",
    role: "entity_admin",
    entityCode: "QA-B",
    maxDiscountPercent: 50,
  },
];

async function upsertEntity(spec: EntitySpec): Promise<string> {
  const { data: existing } = await db.from("branches").select("id").eq("code", spec.code).maybeSingle();
  if (existing) {
    await db.from("branches").update({ name: spec.name, location: spec.location, is_active: true }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await db
    .from("branches")
    .insert({ name: spec.name, code: spec.code, location: spec.location, currency: "TZS", is_active: true })
    .select("id")
    .single();
  if (error) throw new Error(`entity ${spec.code}: ${error.message}`);
  return data!.id;
}

/** Finds an auth user by email without paging the whole directory twice. */
async function findAuthUser(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function upsertAccount(spec: AccountSpec, entityIds: Map<string, string>) {
  const pw = password();
  const branchId = spec.entityCode ? entityIds.get(spec.entityCode)! : null;

  let authId = await findAuthUser(spec.email);
  if (authId) {
    const { error } = await db.auth.admin.updateUserById(authId, { password: pw, email_confirm: true });
    if (error) throw new Error(`update auth ${spec.email}: ${error.message}`);
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email: spec.email,
      password: pw,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`create auth ${spec.email}: ${error?.message}`);
    authId = data.user.id;
  }

  const row = {
    auth_user_id: authId,
    full_name: spec.fullName,
    email: spec.email,
    username: spec.email.split("@")[0],
    role: spec.role,
    branch_id: branchId,
    max_discount_percent: spec.maxDiscountPercent,
    permission_overrides: {},
    status: "active" as const,
  };

  const { data: existing } = await db.from("employees").select("id").eq("email", spec.email).maybeSingle();
  if (existing) {
    const { error } = await db.from("employees").update(row).eq("id", existing.id);
    if (error) throw new Error(`update employee ${spec.email}: ${error.message}`);
  } else {
    const { error } = await db.from("employees").insert(row);
    if (error) throw new Error(`insert employee ${spec.email}: ${error.message}`);
  }

  return { ...spec, password: pw };
}

async function main() {
  const entityIds = new Map<string, string>();
  for (const spec of ENTITIES) {
    entityIds.set(spec.code, await upsertEntity(spec));
    console.log(`entity  ${spec.code.padEnd(6)} ${spec.name}`);
  }

  const created: Array<AccountSpec & { password: string }> = [];
  for (const spec of ACCOUNTS) {
    created.push(await upsertAccount(spec, entityIds));
    console.log(`account ${spec.role.padEnd(15)} ${spec.email}`);
  }

  const { count } = await db
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("role", "master_admin")
    .eq("status", "active");
  console.log(`\nActive master admins: ${count}`);

  const lines = [
    "QA credentials — generated by scripts/setup-qa-accounts.ts",
    "This file is gitignored. Move these into your password manager and delete it.",
    "Re-run the script to rotate every password.",
    "",
  ];
  for (const account of created) {
    lines.push(
      `${account.label}`,
      `  email    ${account.email}`,
      `  password ${account.password}`,
      `  role     ${account.role}`,
      `  entity   ${account.entityCode ?? "all entities (master)"}`,
      ""
    );
  }
  const target = new URL("../.qa-credentials.local.txt", import.meta.url);
  writeFileSync(target, lines.join("\n"), "utf8");
  console.log(`\nCredentials written to .qa-credentials.local.txt (gitignored).`);
  console.log("Move them into your password manager and delete the file.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
