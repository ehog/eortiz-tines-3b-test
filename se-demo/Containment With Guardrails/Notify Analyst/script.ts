import { parseInput } from "./http";

const CHANNEL = "C0A8P2B0Y04";

interface Summary {
  runId?: string;
  status?: string;
  notify?: boolean;
  alertId?: string;
  endpoint?: string;
  userEmail?: string;
  severity?: string;
  chaos?: string[];
  resumeCount?: number;
  succeeded?: { stage: string; label: string; attempts: number }[];
  skipped?: string[];
  failed?: { stage: string; reason: string; classification: string; statusCode: number | null; attempts: number } | null;
  guardrail?: string | null;
  systemState?: {
    ticketNumber?: string | null;
    ticketState?: string | null;
    isolationState?: string | null;
    contained?: boolean;
    safeToRetry?: boolean;
    idempotencyKeys?: Record<string, string | null>;
  };
  resumeFrom?: string | null;
  willSkipOnResume?: string[];
  retryUrl?: string;
  consoleUrl?: string;
}

const summary = (parseInput(await Bun.stdin.text()).body ?? {}) as Summary;

if (!summary.runId) {
  process.stderr.write("no run summary on stdin — nothing to notify\n");
  process.exit(0);
}

if (summary.status === "contained") {
  process.stderr.write(
    `${JSON.stringify({ run_id: summary.runId, event: "notify_skipped", reason: "containment succeeded" })}\n`,
  );
  process.exit(0);
}

const headline =
  summary.status === "partial"
    ? `Containment INCOMPLETE — ${summary.endpoint} is not isolated`
    : summary.status === "blocked"
      ? `Containment BLOCKED — no ticket, no isolation for ${summary.endpoint}`
      : `Containment FAILED during enrichment — ${summary.endpoint}`;

const succeededLines = (summary.succeeded ?? []).map(
  (item) => `• ${item.label} — succeeded${item.attempts > 1 ? ` after ${item.attempts} attempts` : ""}`,
);
const failed = summary.failed;
const state = summary.systemState ?? {};

const blocks: unknown[] = [
  { type: "header", text: { type: "plain_text", text: headline } },
  {
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Run*\n\`${summary.runId}\`` },
      { type: "mrkdwn", text: `*Alert*\n${summary.alertId ?? "unknown"} (${summary.severity ?? "n/a"})` },
      { type: "mrkdwn", text: `*Endpoint*\n${summary.endpoint ?? "unknown"}` },
      { type: "mrkdwn", text: `*User*\n${summary.userEmail ?? "unknown"}` },
    ],
  },
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*What succeeded*\n${succeededLines.length ? succeededLines.join("\n") : "• nothing — the first call never completed"}`,
    },
  },
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*What failed*\n• \`${failed?.stage ?? "unknown"}\` — ${failed?.classification ?? "unknown"} failure, HTTP ${
        failed?.statusCode ?? "none"
      }, ${failed?.attempts ?? 0} attempt(s)\n\`\`\`${(failed?.reason ?? "no detail").slice(0, 400)}\`\`\``,
    },
  },
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*System state right now*\n• ServiceNow: ${
        state.ticketNumber ? `${state.ticketNumber} — ${state.ticketState ?? "unknown state"}` : "no incident created"
      }\n• Endpoint isolation: ${state.isolationState ?? "Not isolated"}\n• Contained: ${state.contained ? "yes" : "no"}\n• Safe to retry: ${
        state.safeToRetry ? "yes — completed steps are skipped on resume" : "no"
      }`,
    },
  },
];

if (summary.guardrail) {
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*Guardrail*\n${summary.guardrail}` },
  });
}

if (summary.retryUrl && summary.resumeFrom) {
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Resume*\nPicks up at \`${summary.resumeFrom}\`; already-completed steps (${
        (summary.willSkipOnResume ?? []).join(", ") || "none"
      }) are skipped, not repeated.`,
    },
    accessory: {
      type: "button",
      style: "primary",
      text: { type: "plain_text", text: `Retry from ${summary.resumeFrom}` },
      url: summary.retryUrl,
    },
  });
}

if ((summary.chaos ?? []).length > 0) {
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Chaos mode active — ${(summary.chaos ?? []).join(" | ")}` }],
  });
}

const response = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ channel: CHANNEL, text: headline, blocks, unfurl_links: false }),
  signal: AbortSignal.timeout(15000),
});

const result = (await response.json()) as { ok?: boolean; error?: string; ts?: string };
process.stderr.write(
  `${JSON.stringify({
    run_id: summary.runId,
    event: "analyst_notified",
    channel: CHANNEL,
    slack_ok: result.ok === true,
    slack_error: result.error ?? null,
    status: summary.status,
  })}\n`,
);

if (!response.ok || result.ok !== true) {
  throw new Error(`Slack rejected the alert: HTTP ${response.status} ${result.error ?? "unknown error"}`);
}
