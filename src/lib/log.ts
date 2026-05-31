/* eslint-disable no-console -- this module IS the structured-log sink; console.* is intentional here */
import { LOG_LEVEL } from "astro:env/server";

/**
 * Structured-logging baseline (F-03).
 *
 * One JSON object per line to stdout — the Cloudflare Workers log sink. No
 * external service, no APM. Every line shares a canonical envelope so the sink
 * (and S-01/S-02/S-03 downstream) can rely on a stable shape.
 *
 * The logger is request-bound: middleware builds one via `createLogger(...)`
 * with the request_id/route/method/user_id pre-filled and stashes it on
 * `locals.log`, so call sites cannot forget the correlation fields. Code with
 * no request context (e.g. the evaluator fallback) uses `baseLogger`.
 */

export type LogLevel = "info" | "warn" | "error";

/** Threshold values: a normal level, or "silent" to suppress everything. */
type Threshold = LogLevel | "silent";

/** Numeric ordering so `shouldLog` can compare a line's level to the threshold. */
const RANK: Record<Threshold, number> = { info: 10, warn: 20, error: 30, silent: 99 };

/** Keys that must never reach a log line, enforced as a backstop to call-site discipline. */
const PII_DENYLIST = new Set(["email", "password", "token", "access_token", "refresh_token"]);

export interface LoggerBase {
  request_id: string;
  route: string;
  method: string;
  user_id?: string | null;
}

export interface LogFields {
  outcome?: "success" | "failure" | null;
  duration_ms?: number;
  /** A raw Error (normalized to {name,message,stack}) or a pre-shaped object. */
  error?: unknown;
  [key: string]: unknown;
}

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** Returns a new logger with merged base fields — e.g. adding user_id after sign-in. */
  child(extra: Partial<LoggerBase>): Logger;
}

function normalizeLevel(raw: unknown): Threshold {
  return raw === "silent" || raw === "warn" || raw === "error" || raw === "info" ? raw : "info";
}

/** Module default, read once from the env. Overridable per logger via opts.level (used by tests). */
const ENV_THRESHOLD: Threshold = normalizeLevel(LOG_LEVEL);

function shouldLog(level: LogLevel, threshold: Threshold): boolean {
  return RANK[level] >= RANK[threshold];
}

function consoleFor(level: LogLevel): (line: string) => void {
  if (level === "error") return console.error;
  if (level === "warn") return console.warn;
  return console.log;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Drop denylisted PII keys (shallow) and normalize any Error into {name,message,stack}. */
function sanitize(fields: LogFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (PII_DENYLIST.has(key)) continue;
    if (key === "error" && value instanceof Error) {
      out.error = { name: value.name, message: value.message, stack: value.stack };
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function createLogger(base: LoggerBase, opts?: { level?: Threshold }): Logger {
  const threshold = opts?.level ?? ENV_THRESHOLD;

  function emit(level: LogLevel, event: string, fields?: LogFields): void {
    if (!shouldLog(level, threshold)) return;
    const line = {
      ts: new Date().toISOString(),
      level,
      event,
      request_id: base.request_id,
      route: base.route,
      method: base.method,
      user_id: base.user_id ?? null,
      outcome: null as "success" | "failure" | null,
      ...sanitize(fields ?? {}),
    };
    consoleFor(level)(JSON.stringify(line));
  }

  return {
    info: (event, fields) => {
      emit("info", event, fields);
    },
    warn: (event, fields) => {
      emit("warn", event, fields);
    },
    error: (event, fields) => {
      emit("error", event, fields);
    },
    child: (extra) => createLogger({ ...base, ...extra }, opts),
  };
}

/** Context-less logger for code outside a request (libs, fallbacks). */
export const baseLogger: Logger = createLogger({ request_id: "-", route: "-", method: "-", user_id: null });

/** One correlation id per request: honor a non-empty inbound x-request-id, else mint a uuid. */
export function resolveRequestId(headers: Headers): string {
  // Truthiness (not ??) is intentional: a blank/whitespace inbound header must
  // fall through to a fresh uuid, and "" is not nullish.
  const inbound = headers.get("x-request-id")?.trim();
  if (inbound) return inbound;
  return crypto.randomUUID();
}

function hasPgCode(value: unknown, code: string): boolean {
  return isRecord(value) && value.code === code;
}

/** True when the error (or its `cause`) carries Postgres code 42501 (RLS / insufficient_privilege). */
export function isRlsDenied(error: unknown): boolean {
  if (hasPgCode(error, "42501")) return true;
  if (isRecord(error) && "cause" in error) return hasPgCode(error.cause, "42501");
  return false;
}
