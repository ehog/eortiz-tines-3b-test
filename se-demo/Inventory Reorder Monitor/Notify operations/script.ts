import { audit, makeLogger } from "./log";

const STEP = "Notify operations";
const CHANNEL = "#eortiz";
const MAX_POS_SHOWN = 8;
const MAX_LINES_SHOWN = 10;

const startedAt = Date.now();

type Line = {
  sku: string;
  name: string;
  quantity: number;
  lineCost: number;
  status: string;
  daysOfCover: number | null;
};

type Po = {
  poNumber: string;
  supplier: string;
  supplierEmail: string;
  expectedOn: string;
  totalCost: number;
  lines: Line[];
};

type Input = {
  runId: string;
  checkedAt: string;
  received: Array<{ poNumber: string; supplier: string; lines: number; units: number }>;
  summary: {
    total: number;
    evaluated: number;
    skipped: number;
    healthy: number;
    low: number;
    critical: number;
    outOfStock: number;
    reorderCount: number;
    estimatedSpend: number;
  };
  purchaseOrders: Po[];
  skipped: Array<{ sku: string; reason: string }>;
};

const input = JSON.parse(await Bun.stdin.text()) as Input;
const log = makeLogger(STEP, input.runId);

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const STATUS_ICON: Record<string, string> = {
  out_of_stock: "🟥",
  critical: "🟧",
  low: "🟨",
  healthy: "🟩",
};

const { summary } = input;
const committed = input.purchaseOrders.reduce((n, p) => n + p.totalCost, 0);
const urgent = summary.critical + summary.outOfStock;

const blocks: unknown[] = [
  {
    type: "header",
    text: {
      type: "plain_text",
      text: input.purchaseOrders.length
        ? `Inventory reorder — ${input.purchaseOrders.length} purchase order${input.purchaseOrders.length === 1 ? "" : "s"} raised`
        : "Inventory check — no reorders needed",
      emoji: true,
    },
  },
  {
    type: "section",
    fields: [
      { type: "mrkdwn", text: `*Items scored*\n${summary.evaluated} of ${summary.total}` },
      { type: "mrkdwn", text: `*Below reorder point*\n${summary.reorderCount}` },
      { type: "mrkdwn", text: `*Urgent*\n${urgent} critical / out of stock` },
      { type: "mrkdwn", text: `*Committed spend*\n${money.format(committed)}` },
    ],
  },
];

if (input.received.length) {
  const text = input.received
    .map((r) => `• *${r.poNumber}* — ${r.supplier}, ${r.units.toLocaleString()} units booked in`)
    .join("\n");
  blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Deliveries received*\n${text}` } });
}

if (input.purchaseOrders.length) {
  blocks.push({ type: "divider" });
  for (const po of input.purchaseOrders.slice(0, MAX_POS_SHOWN)) {
    const shown = po.lines.slice(0, MAX_LINES_SHOWN);
    const lines = shown
      .map(
        (l) =>
          `${STATUS_ICON[l.status] ?? "•"} \`${l.sku}\` ${l.name} — *${l.quantity.toLocaleString()}* @ ${money.format(l.lineCost)}` +
          (l.daysOfCover === null ? "" : ` · ${l.daysOfCover}d cover`),
      )
      .join("\n");
    const more = po.lines.length - shown.length;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*${po.poNumber}* · ${po.supplier} · ${money.format(po.totalCost)} · due ${shortDate(po.expectedOn)}\n` +
          lines +
          (more > 0 ? `\n_+${more} more line${more === 1 ? "" : "s"}_` : ""),
      },
    });
  }
  const hidden = input.purchaseOrders.length - MAX_POS_SHOWN;
  if (hidden > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `_+${hidden} more purchase order${hidden === 1 ? "" : "s"} not shown._` }],
    });
  }
} else {
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: "Every stocked item is above its reorder point. No action needed." },
  });
}

if (input.skipped.length) {
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `_${input.skipped.length} item${input.skipped.length === 1 ? "" : "s"} skipped: ${[...new Set(input.skipped.map((s) => s.reason))].join("; ")}._`,
      },
    ],
  });
}

blocks.push({
  type: "context",
  elements: [
    {
      type: "mrkdwn",
      text: `Checked ${shortDate(input.checkedAt)} · run \`${input.runId.slice(0, 8)}\` · reorder point = avg daily usage × (lead time + safety stock)`,
    },
  ],
});

const fallback = input.purchaseOrders.length
  ? `${input.purchaseOrders.length} purchase order(s) raised, ${money.format(committed)} committed, ${summary.reorderCount} items below reorder point`
  : `Inventory check clear — ${summary.evaluated} items above their reorder points`;

log("info", "notify_started", "Posting the reorder digest to the operations channel.", {
  channel: CHANNEL,
  purchase_orders: input.purchaseOrders.length,
  blocks: blocks.length,
});

const requestedAt = Date.now();
const response = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ channel: CHANNEL, text: fallback, blocks, unfurl_links: false }),
});
const result = (await response.json()) as { ok: boolean; error?: string; ts?: string; channel?: string };

log(result.ok ? "info" : "error", "slack_post", "Called slack.com/api/chat.postMessage.", {
  status: response.status,
  ok: result.ok,
  ...(result.error ? { slack_error: result.error } : {}),
  duration_ms: Date.now() - requestedAt,
});

await audit({
  step: STEP,
  run_id: input.runId,
  action: "operations_notified",
  target: `slack:${CHANNEL}`,
  outcome: result.ok ? "success" : "failure",
  detail: {
    purchase_orders: input.purchaseOrders.length,
    committed_spend: Math.round(committed * 100) / 100,
    reorder_count: summary.reorderCount,
    ...(result.error ? { slack_error: result.error } : { message_ts: result.ts }),
  },
});

if (!result.ok) {
  log("error", "notify_failed", `Slack rejected the message: ${result.error}.`, { channel: CHANNEL });
  process.exit(1);
}

log("info", "notify_completed", "Operations team notified.", {
  channel: result.channel,
  message_ts: result.ts,
  duration_ms: Date.now() - startedAt,
});

console.log(JSON.stringify({ runId: input.runId, notified: true, channel: CHANNEL, messageTs: result.ts }));
