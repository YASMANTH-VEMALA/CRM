import "server-only";
import { getScope } from "./scope";
import { formatTZS } from "@/app/dashboard/views/shared";

export type ExpensesData = {
  stats: Array<[string, string, string]>;
  rows: string[][];
  /** Expense record ids, parallel to `rows` — used to wire the Approve action to the right record. */
  ids: string[];
  /** is_recurring flag, parallel to `rows` — used for tab filtering (not shown as a table column). */
  recurring: boolean[];
  categories: { id: string; name: string }[];
  branches: { id: string; name: string }[];
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export async function getExpensesData(): Promise<ExpensesData> {
  const { supabase, entityId } = await getScope();

  let expenseQuery = supabase
    .from("expenses")
    .select("*, expense_categories(name), employees(full_name)")
    .order("created_at", { ascending: false });
  if (entityId) expenseQuery = expenseQuery.eq("branch_id", entityId);

  // expense_categories is a shared lookup table — not entity-scoped.
  const [{ data: expenses }, { data: categories }, { data: branches }] = await Promise.all([
    expenseQuery,
    supabase.from("expense_categories").select("id, name").eq("is_active", true).order("name"),
    supabase.from("branches").select("id, name").eq("is_active", true).order("name"),
  ]);

  const allExpenses = expenses ?? [];
  const now = new Date();
  const isToday = (value: string) => new Date(value).toDateString() === now.toDateString();
  const isThisMonth = (value: string) => {
    const d = new Date(value);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };

  const todayExpenses = allExpenses.filter((e) => isToday(e.created_at));
  const monthExpenses = allExpenses.filter((e) => isThisMonth(e.created_at));
  const pendingExpenses = allExpenses.filter((e) => e.status === "pending");
  const recurringExpenses = allExpenses.filter((e) => e.is_recurring);

  const sum = (list: { amount: number }[]) => list.reduce((total, e) => total + e.amount, 0);
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

  const stats: Array<[string, string, string]> = [
    ["Today", formatTZS(sum(todayExpenses)), plural(todayExpenses.length, "expense")],
    ["This month", formatTZS(sum(monthExpenses)), plural(monthExpenses.length, "expense")],
    ["Pending", formatTZS(sum(pendingExpenses)), plural(pendingExpenses.length, "request")],
    ["Recurring", formatTZS(sum(recurringExpenses)), plural(recurringExpenses.length, "recurring item")],
  ];

  const rows = allExpenses.map((e) => [
    e.reference,
    e.description ?? "—",
    (e.expense_categories as { name: string } | null)?.name ?? "—",
    e.vendor ?? "—",
    formatTZS(e.amount),
    e.payment_method ?? "—",
    (e.employees as { full_name: string } | null)?.full_name ?? "—",
    titleCase(e.status),
  ]);

  return {
    stats,
    rows,
    ids: allExpenses.map((e) => e.id),
    recurring: allExpenses.map((e) => Boolean(e.is_recurring)),
    categories: categories ?? [],
    branches: branches ?? [],
  };
}
