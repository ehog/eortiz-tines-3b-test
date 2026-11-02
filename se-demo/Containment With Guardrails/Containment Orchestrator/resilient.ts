export type Classification = "transient" | "permanent" | "success";
export type Outcome = "succeeded" | "failed_transient_exhausted" | "failed_permanent";

export const BACKOFF_MS = [1000, 2000, 4000, 8000];
const MAX_BACKOFF_MS = 8000;

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 507, 509]);
const PERMANENT_STATUS = new Set([400, 401, 402, 403, 404, 405, 409, 410, 415, 422, 451]);

export interface AttemptRecord {
  attempt: number;
  outcome: "succeeded" | "transient" | "permanent";
  classification: Classification;
  statusCode: number | null;
  latencyMs: number;
  message: string;
  retryInMs: number | null;
  retriesLeft: number;
}

export interface CallOptions {
  stage: string;
  timeoutMs: number;
  maxRetries: number;
  requestKey: string | null;
  request: (signal: AbortSignal, attempt: number) => Promise<Response>;
  onAttempt: (record: AttemptRecord) => void;
  onBackoff?: (record: { attempt: number; waitMs: number }) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface CallResult<T = unknown> {
  ok: boolean;
  body: T | null;
  attempts: number;
  statusCode: number | null;
  classification: Classification;
  outcome: Outcome;
  message: string;
  durationMs: number;
}

export function classifyStatus(status: number): Classification {
  if (status >= 200 && status < 300) return "success";
  if (TRANSIENT_STATUS.has(status)) return "transient";
  if (PERMANENT_STATUS.has(status)) return "permanent";
  return status >= 500 ? "transient" : "permanent";
}

function classifyError(error: unknown): { classification: Classification; message: string } {
  const err = error as { name?: string; message?: string };
  const name = err?.name ?? "Error";
  const message = err?.message ?? String(error);
  if (name === "TimeoutError" || name === "AbortError") {
    return { classification: "transient", message: `timeout after deadline (${name})` };
  }
  return { classification: "transient", message: `network error: ${message}` };
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(MAX_BACKOFF_MS, Math.max(0, seconds * 1000));
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.min(MAX_BACKOFF_MS, Math.max(0, date - Date.now()));
  return null;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function backoffFor(attempt: number): number {
  const base = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
  const jitter = Math.round(base * 0.2 * Math.random());
  return base + jitter;
}

/**
 * One external call with its own deadline, bounded exponential backoff, and
 * transient/permanent classification. Permanent failures never retry.
 */
export async function resilientCall<T = unknown>(options: CallOptions): Promise<CallResult<T>> {
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();
  const maxAttempts = options.maxRetries + 1;
  let lastStatus: number | null = null;
  let lastMessage = "no attempt made";
  let lastClassification: Classification = "transient";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptStart = Date.now();
    let response: Response | null = null;
    let failure: { classification: Classification; message: string } | null = null;

    try {
      response = await options.request(AbortSignal.timeout(options.timeoutMs), attempt);
    } catch (error) {
      failure = classifyError(error);
    }

    const latencyMs = Date.now() - attemptStart;
    const retriesLeft = maxAttempts - attempt;

    if (response && classifyStatus(response.status) === "success") {
      const text = await response.text();
      options.onAttempt({
        attempt,
        outcome: "succeeded",
        classification: "success",
        statusCode: response.status,
        latencyMs,
        message: `HTTP ${response.status}`,
        retryInMs: null,
        retriesLeft,
      });
      let body: T | null = null;
      try {
        body = text ? (JSON.parse(text) as T) : null;
      } catch {
        body = text as unknown as T;
      }
      return {
        ok: true,
        body,
        attempts: attempt,
        statusCode: response.status,
        classification: "success",
        outcome: "succeeded",
        message: `HTTP ${response.status}`,
        durationMs: Date.now() - startedAt,
      };
    }

    if (response) {
      const classification = classifyStatus(response.status);
      const text = await response.text();
      lastStatus = response.status;
      lastClassification = classification;
      lastMessage = `HTTP ${response.status}: ${(text || "").slice(0, 240) || "no body"}`;
      const hinted = retryAfterMs(response);
      const wait = classification === "transient" && retriesLeft > 0 ? Math.max(hinted ?? 0, backoffFor(attempt)) : null;
      options.onAttempt({
        attempt,
        outcome: classification === "permanent" ? "permanent" : "transient",
        classification,
        statusCode: response.status,
        latencyMs,
        message: lastMessage,
        retryInMs: wait,
        retriesLeft,
      });
      if (classification === "permanent") {
        return {
          ok: false,
          body: null,
          attempts: attempt,
          statusCode: response.status,
          classification: "permanent",
          outcome: "failed_permanent",
          message: lastMessage,
          durationMs: Date.now() - startedAt,
        };
      }
      if (wait === null) break;
      options.onBackoff?.({ attempt, waitMs: wait });
      await sleep(wait);
      continue;
    }

    lastStatus = null;
    lastClassification = failure!.classification;
    lastMessage = failure!.message;
    const wait = retriesLeft > 0 ? backoffFor(attempt) : null;
    options.onAttempt({
      attempt,
      outcome: "transient",
      classification: "transient",
      statusCode: null,
      latencyMs,
      message: lastMessage,
      retryInMs: wait,
      retriesLeft,
    });
    if (wait === null) break;
    options.onBackoff?.({ attempt, waitMs: wait });
    await sleep(wait);
  }

  return {
    ok: false,
    body: null,
    attempts: maxAttempts,
    statusCode: lastStatus,
    classification: lastClassification,
    outcome: "failed_transient_exhausted",
    message: lastMessage,
    durationMs: Date.now() - startedAt,
  };
}
