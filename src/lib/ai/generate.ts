import { CHAT_MODEL, getOpenAI } from "./openai";
import { fetchRecordContext, hydrateExactFacts, semanticSearch, type RetrievedChunk } from "./retrieve";
import type { SourceTable } from "./embed";

const MAX_HISTORY_MESSAGES = 8;
const MAX_CONTEXT_CHARS = 6000;
const MAX_ANSWER_TOKENS = 500;

export type ChatMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT =
  "You are the Mars Pharmacy CRM assistant. Answer only from the CONTEXT block; if the answer isn't there, say you don't know rather than guessing. Values under CURRENT VALUES are live and take priority over anything else in the context. Currency is TZS. Be concise.";

function buildContext(chunks: RetrievedChunk[], facts: Map<string, Record<string, unknown>>): string {
  const text = chunks
    .map((chunk) => {
      const fact = facts.get(`${chunk.sourceTable}:${chunk.sourceId}`);
      return [`[${chunk.sourceTable} #${chunk.sourceId}]`, chunk.content, fact && `CURRENT VALUES: ${JSON.stringify(fact)}`]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n---\n");
  return text.slice(0, MAX_CONTEXT_CHARS);
}

export async function streamAnswer(question: string, history: ChatMessage[]): Promise<ReadableStream<Uint8Array>> {
  const chunks = await semanticSearch(question, { matchCount: 8 });
  const context = buildContext(chunks, await hydrateExactFacts(chunks));

  const completionStream = await getOpenAI().chat.completions.create({
    model: CHAT_MODEL,
    stream: true,
    temperature: 0.2,
    max_tokens: MAX_ANSWER_TOKENS,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `CONTEXT:\n${context || "(no matching records)"}` },
      ...history.slice(-MAX_HISTORY_MESSAGES),
      { role: "user", content: question },
    ],
  });

  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const part of completionStream) {
          const delta = part.choices[0]?.delta?.content;
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
}

// For summarize/draft: the user picked a specific record (a dropdown), so
// context comes from a direct live fetch of that record, not a semantic
// search — an instruction sentence like "summarize this record" would not
// reliably retrieve the one the user actually chose.
export async function generateForRecord(
  instruction: string,
  sourceTable: SourceTable,
  sourceId: string,
  maxTokens = 250
): Promise<string> {
  const record = await fetchRecordContext(sourceTable, sourceId);
  if (!record) throw new Error("Record not found.");

  const context = [`[${sourceTable} #${sourceId}]`, record.content, `CURRENT VALUES: ${JSON.stringify(record.facts)}`]
    .join("\n")
    .slice(0, MAX_CONTEXT_CHARS);

  const completion = await getOpenAI().chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.3,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: `CONTEXT:\n${context}` },
      { role: "user", content: instruction },
    ],
  });

  return completion.choices[0]?.message?.content ?? "";
}
