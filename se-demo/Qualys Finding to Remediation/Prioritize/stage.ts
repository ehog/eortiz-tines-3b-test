// Boilerplate every pipeline stage shares: work out how the run arrived, find
// the stage's input, record the result for the console, and decide whether to
// emit to downstream steps.
//
// A stage runs three ways:
//   - linked from upstream: stdin is the upstream envelope
//   - its own route with a JSON body: that body is the input
//   - its own route with no body: replay the last recorded upstream payload
// `?only=1` records the result but writes nothing, so no downstream step fires.
import { isHttpRequest, parseRequest } from "./http";
import { openWrite, recordStage, latestPayload, newRunId } from "./pipeline-db";
import type { Database } from "bun:sqlite";

export type Invocation = {
  viaHttp: boolean;
  only: boolean;
  trigger: "schedule" | "manual" | "webhook";
  body: string;
};

export function readInvocation(raw: string): Invocation {
  if (!isHttpRequest(raw)) {
    return { viaHttp: false, only: false, trigger: "schedule", body: raw };
  }
  const req = parseRequest(raw);
  return {
    viaHttp: true,
    only: req.query.get("only") === "1",
    trigger: req.query.get("trigger") === "webhook" ? "webhook" : "manual",
    body: req.body,
  };
}

export type StageResult<TOut> = {
  payload: TOut;
  count: number;
  summary: string;
  /** false records the run but emits nothing, halting the pipeline here. */
  emit?: boolean;
  /** Emit this text instead of the JSON payload, for human-readable terminal stages. */
  raw?: string;
};

export async function runStage<TIn, TOut>(opts: {
  stage: string;
  upstreamStage?: string;
  handler: (input: TIn | null, ctx: { db: Database; runId: string; invocation: Invocation }) => Promise<StageResult<TOut>>;
}): Promise<void> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const raw = await Bun.stdin.text();
  const invocation = readInvocation(raw);
  const db = openWrite();

  let input: TIn | null = null;
  if (invocation.body.trim()) {
    try {
      input = JSON.parse(invocation.body) as TIn;
    } catch (err) {
      throw new Error(`stage input is not valid JSON: ${(err as Error).message}`);
    }
  } else if (invocation.viaHttp && opts.upstreamStage) {
    input = latestPayload<TIn>(db, opts.upstreamStage);
  }

  const runId =
    (input as { run_id?: string } | null)?.run_id ??
    (invocation.viaHttp ? `${newRunId()}-manual` : newRunId());

  try {
    const result = await opts.handler(input, { db, runId, invocation });
    recordStage(db, {
      run_id: runId,
      stage: opts.stage,
      trigger: invocation.trigger,
      status: result.count === 0 && result.emit === false ? "skipped" : "success",
      started_at: startedAt,
      duration_ms: Date.now() - started,
      record_count: result.count,
      summary: result.summary,
      payload: result.payload,
    });
    if (result.emit !== false && !invocation.only) {
      process.stdout.write(result.raw ?? JSON.stringify(result.payload));
    }
    console.error(`${opts.stage}: ${result.summary}`);
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    recordStage(db, {
      run_id: runId,
      stage: opts.stage,
      trigger: invocation.trigger,
      status: "error",
      started_at: startedAt,
      duration_ms: Date.now() - started,
      record_count: 0,
      summary: `failed: ${err instanceof Error ? err.message : String(err)}`,
      payload: {},
      error: message,
    });
    throw err;
  }
}
