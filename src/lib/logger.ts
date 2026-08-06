import "server-only";

/**
 * Structured server-side logging.
 *
 * The audit found `console.error` was the only sink anywhere in the app, with
 * no context and nothing an operator could search. This emits single-line JSON
 * so a hosting platform's log drain (Vercel, CloudWatch, Logtail…) can index
 * it, and gives errors a stable shape: event, module, message, and whatever
 * context the call site attaches.
 *
 * Deliberately dependency-free — wiring a real APM is a Phase 2 decision, and
 * this keeps the call sites identical when that happens.
 */

type Level = "info" | "warn" | "error";
type Context = Record<string, unknown>;

/** Keys whose values are never written to logs, at any nesting level. */
const REDACT = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "apikey",
  "api_key",
  "authorization",
  "service_role_key",
  "buy_price",
  "unit_cost",
]);

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Context)) {
      out[key] = REDACT.has(key.toLowerCase()) ? "[redacted]" : scrub(val, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, event: string, context: Context = {}) {
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...(scrub(context) as Context),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, context?: Context) => emit("info", event, context),
  warn: (event: string, context?: Context) => emit("warn", event, context),
  /**
   * Records a failure. `error` is unwrapped to message + name; stacks are kept
   * for real Error instances and dropped for opaque values.
   */
  error: (event: string, error: unknown, context?: Context) =>
    emit("error", event, {
      ...context,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
    }),
};
