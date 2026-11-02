import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { LanguageModelUsage, ModelMessage } from "ai";

const ROOT = "/storage/conversations";

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};

export type MessageRecord = {
  kind: "message";
  at: number;
  message: ModelMessage;
};
export type UsageRecord = {
  kind: "usage";
  at: number;
  turn: number;
  usage: UsageTotals;
};
export type TranscriptRecord = MessageRecord | UsageRecord;

function segment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 128) || "anonymous";
}

// Isolate transcripts per owner so a caller can never reach another's thread by
// guessing its conversation id: `owner` is the platform-verified principal for a
// routed agent (the conversation id alone is caller-controlled, not an isolation
// boundary). The owner directory carries a hash suffix because sanitization alone
// can collapse distinct principals (a.b@c and a-b@c) into the same name.
export function transcriptPath(owner: string, conversation: string): string {
  const hash = new Bun.CryptoHasher("sha256")
    .update(owner)
    .digest("hex")
    .slice(0, 16);
  return `${ROOT}/${segment(owner)}-${hash}/${segment(conversation)}.jsonl`;
}

export function emptyUsage(): UsageTotals {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
}

// Capture the whole usage object — cache-read, cache-write, and reasoning
// tokens are each priced differently and easy to undercount.
export function normaliseUsage(usage: LanguageModelUsage): UsageTotals {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
  };
}

export function addUsage(totals: UsageTotals, turn: UsageTotals): void {
  totals.inputTokens += turn.inputTokens;
  totals.outputTokens += turn.outputTokens;
  totals.totalTokens += turn.totalTokens;
  totals.cacheReadTokens += turn.cacheReadTokens;
  totals.cacheWriteTokens += turn.cacheWriteTokens;
  totals.reasoningTokens += turn.reasoningTokens;
}

// `steps` counts one usage record per model request, across every run of the
// conversation — the basis for the cross-run maxSteps budget.
export async function readHistory(
  path: string
): Promise<{ messages: ModelMessage[]; steps: number }> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { messages: [], steps: 0 };
  const messages: ModelMessage[] = [];
  let steps = 0;
  for (const line of (await file.text()).split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as TranscriptRecord;
    if (record.kind === "message") messages.push(record.message);
    if (record.kind === "usage") steps += 1;
  }
  return { messages, steps };
}

// Append-only so concurrent requests on the same conversation interleave at
// record boundaries instead of clobbering each other.
export async function appendRecords(
  path: string,
  records: TranscriptRecord[]
): Promise<void> {
  if (records.length === 0) return;
  await mkdir(dirname(path), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n");
  await appendFile(path, `${lines}\n`);
}
