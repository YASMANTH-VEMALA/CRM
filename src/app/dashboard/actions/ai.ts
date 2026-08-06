"use server";

import { requireUser } from "@/lib/dal";
import { semanticSearch, type RetrievedChunk } from "@/lib/ai/retrieve";
import { generateForRecord } from "@/lib/ai/generate";
import type { SourceTable } from "@/lib/ai/embed";
import { log } from "@/lib/logger";

export type AiSearchState = { ok: true; query: string; results: RetrievedChunk[] } | { ok: false; error: string } | null;

export async function aiSearch(_prevState: AiSearchState, formData: FormData): Promise<AiSearchState> {
  await requireUser();
  const query = String(formData.get("query") ?? "").trim();
  if (!query) return { ok: false, error: "Enter a search query." };

  try {
    const results = await semanticSearch(query, { matchCount: 10 });
    return { ok: true, query, results };
  } catch (err) {
    log.error("ai.search_failed", err);
    return { ok: false, error: "Search is unavailable right now." };
  }
}

export type SummarizeState = { ok: true; summary: string } | { ok: false; error: string } | null;

export async function summarizeRecord(_prevState: SummarizeState, formData: FormData): Promise<SummarizeState> {
  await requireUser();
  const sourceTable = String(formData.get("source_table") ?? "") as SourceTable;
  const sourceId = String(formData.get("source_id") ?? "");
  if (!sourceTable || !sourceId) return { ok: false, error: "Pick a record to summarize." };

  try {
    const singular = sourceTable.slice(0, -1);
    const summary = await generateForRecord(`Summarize this ${singular} record for a pharmacy staff member.`, sourceTable, sourceId, 200);
    return { ok: true, summary };
  } catch (err) {
    log.error("ai.summarize_failed", err);
    return { ok: false, error: "Could not generate a summary right now." };
  }
}

export type DraftState = { ok: true; draft: string } | { ok: false; error: string } | null;

export async function draftMessage(_prevState: DraftState, formData: FormData): Promise<DraftState> {
  await requireUser();
  const customerId = String(formData.get("customer_id") ?? "");
  const intent = String(formData.get("intent") ?? "").trim();
  if (!customerId || !intent) return { ok: false, error: "Pick a customer and describe what to draft." };

  try {
    const draft = await generateForRecord(`Draft a short, friendly message to this customer. Intent: ${intent}`, "customers", customerId, 250);
    return { ok: true, draft };
  } catch (err) {
    log.error("ai.draft_failed", err);
    return { ok: false, error: "Could not generate a draft right now." };
  }
}
