import {
  SOURCES,
  dir,
  logger,
  readInput,
  readJson,
  sanitizeId,
  writeJson,
  type Entities,
  type Incident,
  type SourceResult,
  type TimelineEvent,
} from "./lib";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 8192;

const input = await readInput();
const payload = (input.json ?? {}) as Record<string, unknown>;
const investigationId = sanitizeId(payload.investigationId ?? input.query.get("id"));
const audit = logger(investigationId, "Summarize");

const base = dir(investigationId);
const incident = await readJson<Incident>(`${base}/incident.json`);
const entities = await readJson<Entities>(`${base}/entities.json`);
const timeline = await readJson<{ events: TimelineEvent[]; missingSources: string[] }>(`${base}/timeline.json`);
if (!incident || !entities || !timeline) throw new Error(`investigation ${investigationId} is not ready to summarize`);

const sourceSummaries: Record<string, unknown> = {};
for (const source of SOURCES) {
  const result = await readJson<SourceResult>(`${base}/${source}.json`);
  if (result) sourceSummaries[source] = { status: result.status, recordCount: result.recordCount, data: condense(result.data) };
}

const evidencePacket = {
  incident: {
    source: incident.source,
    vendorId: incident.vendorId,
    title: incident.title,
    description: incident.description,
    severity: incident.severity,
    alertTime: incident.alertTime,
  },
  entities,
  missingSources: timeline.missingSources,
  timeline: timeline.events.map((event) => ({
    id: event.id,
    ts: event.ts,
    source: event.source,
    title: event.title,
    detail: event.detail.slice(0, 300),
    severity: event.severity,
  })),
  toolData: sourceSummaries,
};

const system = [
  "You are a senior SOC analyst writing the triage note another analyst will act on.",
  "Use only facts present in the supplied evidence. Never invent hosts, users, IPs, verdicts, timestamps, or tooling output.",
  "If evidence for something is absent, say it is not present in the collected data.",
  "Every evidence item must cite the timeline event ids it comes from.",
  "Be concise: summary at most 140 words, attackNarrative at most 120 words, at most 7 evidence items,",
  "at most 4 gaps and at most 5 recommendedActions, each one sentence.",
  "Reply with a single JSON object and no prose or code fences, shaped:",
  '{"headline":string,"summary":string,"attackNarrative":string,"disposition":"benign"|"needs_review"|"likely_true_positive",',
  '"confidence":number(0-100),"evidence":[{"claim":string,"eventIds":[string]}],"gaps":[string],"recommendedActions":[string]}',
].join("\n");

const started = Date.now();
const response = await fetch(`${process.env.ANTHROPIC_BASE_URL}/messages`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": "placeholder",
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [
      {
        role: "user",
        content: `Evidence collected for investigation ${investigationId}:\n\n${JSON.stringify(evidencePacket)}`,
      },
    ],
  }),
});

if (!response.ok) {
  const detail = await response.text();
  audit.log("claude_request", MODEL, `error:${response.status}`, Date.now() - started);
  throw new Error(`Anthropic API returned ${response.status}: ${detail.slice(0, 500)}`);
}

const completion = (await response.json()) as {
  content: { type: string; text?: string }[];
  usage?: { input_tokens: number; output_tokens: number };
};
audit.log(
  "claude_request",
  MODEL,
  `ok:in=${completion.usage?.input_tokens ?? 0},out=${completion.usage?.output_tokens ?? 0}`,
  Date.now() - started,
);

const text = completion.content
  .filter((block) => block.type === "text")
  .map((block) => block.text ?? "")
  .join("")
  .trim();

const parsed = parseJson(text);
const validEventIds = new Set(timeline.events.map((event) => event.id));
const summary = {
  investigationId,
  model: MODEL,
  generatedAt: new Date().toISOString(),
  headline: String(parsed.headline ?? incident.title),
  summary: String(parsed.summary ?? ""),
  attackNarrative: String(parsed.attackNarrative ?? ""),
  disposition: normalizeDisposition(String(parsed.disposition ?? "needs_review")),
  confidence: clamp(Number(parsed.confidence ?? 50)),
  evidence: asArray(parsed.evidence).map((item) => {
    const record = item as Record<string, unknown>;
    return {
      claim: String(record.claim ?? ""),
      eventIds: asArray(record.eventIds)
        .map(String)
        .filter((id) => validEventIds.has(id)),
    };
  }),
  gaps: asArray(parsed.gaps).map(String),
  recommendedActions: asArray(parsed.recommendedActions).map(String),
  missingSources: timeline.missingSources,
  logs: audit.records,
};

await writeJson(`${base}/summary.json`, summary);
audit.log("summary_written", summary.disposition, `confidence=${summary.confidence}`);
console.log(JSON.stringify({ investigationId, disposition: summary.disposition, confidence: summary.confidence }));

function parseJson(raw: string): Record<string, unknown> {
  const withoutFence = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(withoutFence) as Record<string, unknown>;
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1)) as Record<string, unknown>;
    throw new Error(`model did not return JSON: ${raw.slice(0, 300)}`);
  }
}

function normalizeDisposition(value: string): string {
  const lowered = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (lowered === "benign" || lowered === "needs_review" || lowered === "likely_true_positive") return lowered;
  return "needs_review";
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Tool payloads run to hundreds of rows; the timeline already carries the narrative, so long
 * arrays are trimmed to a representative head before the model sees them. */
function condense(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    const head = value.slice(0, 5).map((item) => condense(item, depth + 1));
    return value.length > 5 ? [...head, `…${value.length - 5} more of ${value.length} records omitted`] : head;
  }
  if (value && typeof value === "object") {
    if (depth > 4) return "…nested detail omitted";
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, condense(item, depth + 1)]));
  }
  if (typeof value === "string" && value.length > 300) return `${value.slice(0, 300)}…`;
  return value;
}
