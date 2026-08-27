import { getConfig, openWritable, logEvent, truncate } from "./soclib";

type Correlated = {
  window: { start: string; end: string; lookbackHours: number; etLabel: string };
  trigger: string;
  stats: Record<string, number>;
  config?: { pageThreshold: number; suppressBelowScore: number; model: string; delivery: Record<string, string> };
  bySource: Record<string, { total: number; open: number; closedOrSuppressed: number }>;
  entities: Array<Record<string, any>>;
  closedOrSuppressed: Array<Record<string, any>>;
};

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("No correlated payload on stdin.");
  process.exit(1);
}
const input = JSON.parse(raw) as Correlated;

const db = openWritable();
const config = getConfig(db);

type AiDigest = {
  headline: string;
  actionItems: Array<{
    entityId: string;
    title: string;
    whyThisMatters: string;
    recommendedAction: string;
    affected: string;
  }>;
  watchList: Array<{ title: string; note: string }>;
  autoClosedSummary: string;
};

const TOOL = {
  name: "emit_digest",
  description: "Return the prioritised morning SOC digest content.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One sentence describing the overnight picture." },
      actionItems: {
        type: "array",
        description: "Entities needing analyst action, most urgent first. At most 6.",
        items: {
          type: "object",
          properties: {
            entityId: { type: "string" },
            title: { type: "string", description: "Short action-oriented headline for the correlated entity." },
            whyThisMatters: { type: "string", description: "Exactly one line explaining the business risk." },
            recommendedAction: { type: "string", description: "The concrete next step for the analyst." },
            affected: { type: "string", description: "Users, hosts and indicators involved." },
          },
          required: ["entityId", "title", "whyThisMatters", "recommendedAction", "affected"],
        },
      },
      watchList: {
        type: "array",
        description: "Lower priority items worth a glance. At most 5.",
        items: {
          type: "object",
          properties: { title: { type: "string" }, note: { type: "string" } },
          required: ["title", "note"],
        },
      },
      autoClosedSummary: { type: "string", description: "Two sentences at most about what closed or was suppressed automatically." },
    },
    required: ["headline", "actionItems", "watchList", "autoClosedSummary"],
  },
} as const;

const promptPayload = {
  window: input.window,
  stats: input.stats,
  bySource: input.bySource,
  pageThreshold: input.config?.pageThreshold ?? config.pageThreshold,
  entities: input.entities.slice(0, 20).map((e) => ({
    id: e.id,
    titles: e.titles,
    maxSeverity: e.maxSeverity,
    confidences: e.confidences,
    sources: e.sources,
    subjects: e.subjects,
    criticalAssets: e.criticalAssets,
    gate: e.gate,
    occurrences: e.occurrences,
    priorityScore: e.priorityScore,
    firstSeen: e.firstSeen,
    lastSeen: e.lastSeen,
    members: e.members,
  })),
  closedOrSuppressed: input.closedOrSuppressed.slice(0, 40),
};

async function callClaude(): Promise<AiDigest | null> {
  const base = (process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const url = base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "connector-injected",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.digest.model,
      max_tokens: 3000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "emit_digest" },
      system:
        "You are the lead analyst writing the 06:00 ET shift-change digest for a security operations centre. " +
        "Prioritise by real business risk: tier 0 assets, confirmed detections, multi-source corroboration and anything the " +
        "after-hours gate already paged or deferred. Write for a tired analyst: plain, specific, no filler, no marketing language. " +
        "Each 'whyThisMatters' must be a single line naming the concrete business consequence. Never invent detail that is not in the data. " +
        "Use the entity ids exactly as given.",
      messages: [
        {
          role: "user",
          content:
            "Correlated overnight security activity follows as JSON. Every entity is already deduplicated and correlated by user, host " +
            "and indicator. Produce the digest content.\n\n```json\n" +
            JSON.stringify(promptPayload) +
            "\n```",
        },
      ],
    }),
  });
  if (!res.ok) {
    console.error(`Anthropic request failed: ${res.status} ${truncate(await res.text(), 400)}`);
    return null;
  }
  const body = (await res.json()) as { content: Array<{ type: string; name?: string; input?: unknown }> };
  const block = body.content?.find((c) => c.type === "tool_use" && c.name === "emit_digest");
  return (block?.input as AiDigest) ?? null;
}

let ai: AiDigest | null = null;
let aiStatus = "ok";
try {
  ai = await callClaude();
  if (!ai) {
    ai = await callClaude();
    if (!ai) aiStatus = "unavailable";
  }
} catch (err) {
  aiStatus = `error: ${err instanceof Error ? err.message : String(err)}`;
  console.error(`Claude call threw: ${aiStatus}`);
}

if (!ai) {
  // Deterministic fallback so the shift always gets a digest even if the model is unreachable.
  ai = {
    headline: `${input.entities.length} correlated items overnight; ${input.stats.pagedOvernight ?? 0} paged, ${input.stats.deferredFromGate ?? 0} deferred by the after-hours gate.`,
    actionItems: input.entities.slice(0, 6).map((e) => ({
      entityId: e.id,
      title: e.titles[0] ?? "Correlated activity",
      whyThisMatters: e.criticalAssets?.length
        ? `Touches ${e.criticalAssets[0].tier} asset ${e.criticalAssets[0].hostname} (${e.criticalAssets[0].businessService}).`
        : `${e.maxSeverity} severity across ${e.sources.length} source(s).`,
      recommendedAction: "Review the correlated events and confirm containment.",
      affected: [...(e.subjects?.users ?? []), ...(e.subjects?.hosts ?? []), ...(e.subjects?.indicators ?? [])].join(", ") || "—",
    })),
    watchList: input.entities.slice(6, 11).map((e) => ({
      title: e.titles[0] ?? "Correlated activity",
      note: `${e.maxSeverity} severity, sources: ${e.sources.join(", ")}`,
    })),
    autoClosedSummary: `${input.stats.closedOrSuppressed ?? 0} items closed at the source or were suppressed by the gate and need no action.`,
  };
}

const entityById = new Map(input.entities.map((e) => [e.id, e]));
const etDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "long",
  month: "long",
  day: "numeric",
}).format(new Date(input.window.end));

const totalBySource = Object.entries(input.bySource).sort((a, b) => b[1].total - a[1].total);
const subject = `Morning SOC digest — ${etDate} — ${ai.actionItems.length} item(s) need action`;

const countsTableMd = [
  "| Source | Total | Needs review | Auto-closed / suppressed |",
  "| --- | --- | --- | --- |",
  ...totalBySource.map(([s, c]) => `| ${s} | ${c.total} | ${c.open} | ${c.closedOrSuppressed} |`),
  `| **all sources** | **${totalBySource.reduce((n, [, c]) => n + c.total, 0)}** | **${totalBySource.reduce((n, [, c]) => n + c.open, 0)}** | **${totalBySource.reduce((n, [, c]) => n + c.closedOrSuppressed, 0)}** |`,
].join("\n");

const markdown = [
  `## Morning SOC digest — ${etDate}`,
  `_Window ${input.window.start} → ${input.window.end} (${input.window.lookbackHours}h). ${ai.headline}_`,
  "",
  "### Needs action now",
  ...(ai.actionItems.length === 0
    ? ["Nothing requires analyst action from the overnight window."]
    : ai.actionItems.flatMap((item, i) => {
        const e = entityById.get(item.entityId);
        const meta = e
          ? `${e.maxSeverity} · sources: ${e.sources.join(", ")} · ${e.occurrences} event(s)${
              e.criticalAssets?.length ? ` · ${e.criticalAssets.map((a: any) => `${a.hostname} (${a.tier})`).join(", ")}` : ""
            }${e.gate?.maxScore !== null && e.gate?.maxScore !== undefined ? ` · gate score ${e.gate.maxScore}` : ""}`
          : "";
        return [
          `**${i + 1}. ${item.title}**`,
          `- Why this matters: ${item.whyThisMatters}`,
          `- Affected: ${item.affected}`,
          `- Next step: ${item.recommendedAction}`,
          ...(meta ? [`- Context: ${meta}`] : []),
          "",
        ];
      })),
  ...(ai.watchList.length ? ["### Worth a glance", ...ai.watchList.map((w) => `- **${w.title}** — ${w.note}`), ""] : []),
  "### Counts by source",
  countsTableMd,
  "",
  "### Auto-closed and suppressed",
  ai.autoClosedSummary,
  "",
  ...input.closedOrSuppressed
    .slice(0, 25)
    .map(
      (c) =>
        `- ${c.source} · ${c.title}${c.occurrences > 1 ? ` (×${c.occurrences})` : ""} — ${c.state}${c.reason ? `: ${truncate(String(c.reason), 160)}` : ""}`,
    ),
  "",
  `_Gate activity in window: ${input.stats.pagedOvernight ?? 0} paged, ${input.stats.deferredFromGate ?? 0} deferred, ${input.stats.duplicatesRemoved} duplicates removed, ${input.stats.multiSourceEntities} multi-source correlations. Digest content ${aiStatus === "ok" ? "written by Claude" : `generated without Claude (${aiStatus})`}._`,
].join("\n");

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const html = `<!DOCTYPE html>
<html><body style="margin:0;background:#0b1220;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:720px;margin:0 auto;background:#111a2e;border:1px solid #1f2d4a;border-radius:12px;overflow:hidden">
  <div style="padding:20px 24px;background:linear-gradient(135deg,#1b2a4a,#0f1a30);border-bottom:1px solid #1f2d4a">
    <div style="color:#7dd3fc;font-size:12px;letter-spacing:.14em;text-transform:uppercase">Morning SOC digest</div>
    <div style="color:#f8fafc;font-size:22px;font-weight:600;margin-top:6px">${esc(etDate)}</div>
    <div style="color:#94a3b8;font-size:13px;margin-top:8px">${esc(ai.headline)}</div>
  </div>
  <div style="padding:20px 24px">
    <h2 style="color:#f8fafc;font-size:15px;margin:0 0 12px">Needs action now</h2>
    ${
      ai.actionItems.length === 0
        ? '<p style="color:#94a3b8;font-size:14px">Nothing requires analyst action from the overnight window.</p>'
        : ai.actionItems
            .map((item, i) => {
              const e = entityById.get(item.entityId);
              return `<div style="border:1px solid #24334f;border-left:3px solid #f97316;border-radius:8px;padding:14px;margin-bottom:12px;background:#0f1830">
        <div style="color:#f8fafc;font-size:15px;font-weight:600">${i + 1}. ${esc(item.title)}</div>
        <div style="color:#fbbf24;font-size:13px;margin-top:8px"><strong>Why this matters:</strong> ${esc(item.whyThisMatters)}</div>
        <div style="color:#cbd5e1;font-size:13px;margin-top:6px"><strong>Affected:</strong> ${esc(item.affected)}</div>
        <div style="color:#cbd5e1;font-size:13px;margin-top:6px"><strong>Next step:</strong> ${esc(item.recommendedAction)}</div>
        ${
          e
            ? `<div style="color:#64748b;font-size:12px;margin-top:8px">${esc(e.maxSeverity)} · ${esc(e.sources.join(", "))} · ${esc(e.occurrences)} event(s)${
                e.criticalAssets?.length ? ` · ${esc(e.criticalAssets.map((a: any) => `${a.hostname} (${a.tier})`).join(", "))}` : ""
              }</div>`
            : ""
        }
      </div>`;
            })
            .join("")
    }
    ${
      ai.watchList.length
        ? `<h2 style="color:#f8fafc;font-size:15px;margin:22px 0 10px">Worth a glance</h2>
    <ul style="color:#cbd5e1;font-size:13px;padding-left:18px;margin:0">${ai.watchList
      .map((w) => `<li style="margin-bottom:6px"><strong style="color:#e2e8f0">${esc(w.title)}</strong> — ${esc(w.note)}</li>`)
      .join("")}</ul>`
        : ""
    }
    <h2 style="color:#f8fafc;font-size:15px;margin:22px 0 10px">Counts by source</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr>${["Source", "Total", "Needs review", "Auto-closed"]
        .map((h) => `<th style="text-align:left;color:#7dd3fc;border-bottom:1px solid #24334f;padding:6px 8px;font-weight:600">${h}</th>`)
        .join("")}</tr></thead>
      <tbody>${totalBySource
        .map(
          ([s, c]) =>
            `<tr><td style="color:#e2e8f0;padding:6px 8px;border-bottom:1px solid #182338">${esc(s)}</td><td style="color:#cbd5e1;padding:6px 8px;border-bottom:1px solid #182338">${c.total}</td><td style="color:#fbbf24;padding:6px 8px;border-bottom:1px solid #182338">${c.open}</td><td style="color:#64748b;padding:6px 8px;border-bottom:1px solid #182338">${c.closedOrSuppressed}</td></tr>`,
        )
        .join("")}</tbody>
    </table>
    <h2 style="color:#f8fafc;font-size:15px;margin:22px 0 10px">Auto-closed and suppressed</h2>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 8px">${esc(ai.autoClosedSummary)}</p>
    <ul style="color:#64748b;font-size:12px;padding-left:18px;margin:0">${input.closedOrSuppressed
      .slice(0, 25)
      .map((c) => `<li style="margin-bottom:4px">${esc(c.source)} · ${esc(c.title)}${c.occurrences > 1 ? ` (×${c.occurrences})` : ""} — ${esc(c.state)}</li>`)
      .join("")}</ul>
  </div>
  <div style="padding:14px 24px;background:#0d1526;border-top:1px solid #1f2d4a;color:#475569;font-size:11px">
    Window ${esc(input.window.start)} → ${esc(input.window.end)} · ${input.stats.duplicatesRemoved} duplicates removed ·
    ${input.stats.multiSourceEntities} multi-source correlations · ${input.stats.pagedOvernight ?? 0} paged overnight ·
    ${input.stats.deferredFromGate ?? 0} deferred by the gate · digest content ${aiStatus === "ok" ? "written by Claude" : `generated without Claude (${aiStatus})`}
  </div>
</div>
</body></html>`;

const slackText = [
  `*Morning SOC digest — ${etDate}*`,
  ai.headline,
  "",
  "*Needs action now*",
  ...(ai.actionItems.length === 0
    ? ["• Nothing requires analyst action."]
    : ai.actionItems.map((item, i) => `${i + 1}. *${item.title}*\n     _Why this matters:_ ${item.whyThisMatters}\n     _Affected:_ ${item.affected}\n     _Next step:_ ${item.recommendedAction}`)),
  "",
  "*Counts by source*",
  ...totalBySource.map(([s, c]) => `• ${s}: ${c.total} total · ${c.open} to review · ${c.closedOrSuppressed} auto-closed`),
  "",
  `*Auto-closed / suppressed*\n${ai.autoClosedSummary}`,
].join("\n");

const insert = db
  .query<{ id: number }, [string, string, string, string, number, string, string, string, string]>(
    `INSERT INTO digests (created_at, status, window_start, window_end, item_count, markdown, html, slack_text, json)
     VALUES (?, 'generated', ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
  .get(
    new Date().toISOString(),
    input.window.start,
    input.window.end,
    ai.actionItems.length,
    markdown,
    html,
    slackText,
    JSON.stringify({ ai, stats: input.stats, bySource: input.bySource, aiStatus, trigger: input.trigger, subject }),
  );

const digestId = insert?.id ?? 0;

db.query("UPDATE deferred_queue SET digested_at = ? WHERE digested_at IS NULL AND queued_at >= ?").run(
  new Date().toISOString(),
  input.window.start,
);
logEvent(db, new Date().toISOString(), "digest", `Digest #${digestId} generated with ${ai.actionItems.length} action item(s)`, {
  digestId,
  aiStatus,
  trigger: input.trigger,
});
db.close();

console.error(`Digest #${digestId} built (${aiStatus}); ${ai.actionItems.length} action items, ${ai.watchList.length} watch items.`);

console.log(
  JSON.stringify({
    digestId,
    subject,
    markdown,
    html,
    slackText,
    delivery: config.delivery,
    stats: input.stats,
    aiStatus,
  }),
);
