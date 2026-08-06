import { getCurrentEmployee } from "@/lib/dal";
import { streamAnswer, type ChatMessage } from "@/lib/ai/generate";
import { log } from "@/lib/logger";

export async function POST(request: Request) {
  const employee = await getCurrentEmployee();
  if (!employee) return new Response("Unauthorized", { status: 401 });

  let body: { question?: string; history?: ChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) return new Response("`question` is required.", { status: 400 });
  if (question.length > 2000) return new Response("Question is too long.", { status: 400 });

  const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

  try {
    const stream = await streamAnswer(question, history);
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    log.error("ai.chat_failed", err);
    return new Response("The assistant is unavailable right now.", { status: 502 });
  }
}
