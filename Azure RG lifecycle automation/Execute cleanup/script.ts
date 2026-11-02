import { API, type Arm, createClients } from "./arm";
import { type Config, isDoNotDelete, isProtectedRg, loadConfig, lockGranule } from "./config";
import { parseHttp } from "./http";
import { audit, log, main } from "./log";
import { type CleanupItem, apiVersionFor, expiredReason, orphanReason } from "./rules";
import {
  type PlanDecision,
  activeAllocations,
  addRecord,
  nowIso,
  planStatus,
  readPlan,
  releaseAllocation,
  saveDecision,
} from "./store";

const BUDGET_MS = 240_000;

interface ItemResult {
  item: CleanupItem;
  outcome: "deleted" | "released" | "already_gone" | "skipped" | "pending" | "failed" | "deferred";
  detail: string;
}

function readDecision(raw: string): PlanDecision | null {
  if (!raw.trim().startsWith("HTTP/")) return null;
  const header = parseHttp(raw).headers["x-rglc-decision"];
  if (!header) return null;
  return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
}

async function stillEligible(arm: Arm, cfg: Config, item: CleanupItem, current: any) {
  const rgPath = `/subscriptions/${item.subscriptionId}/resourceGroups/${item.rgName}`;
  const rg = await arm.get(rgPath, API.resources);
  if (isDoNotDelete(current.tags)) return "now tagged do-not-delete=true";
  if (isProtectedRg(cfg, item.rgName, rg?.tags)) return "resource group is now protected";
  const today = nowIso().slice(0, 10);
  if (item.kind === "expired_resource" || item.kind === "expired_rg") {
    return expiredReason(current.tags, today) ? null : "expires-on tag changed";
  }
  if (item.kind === "empty_rg") {
    const children = await arm.list(`${item.id}/resources`, API.resources);
    return children.length ? "resource group is no longer empty" : null;
  }
  return orphanReason(item.kind, current) ? null : "resource is attached again";
}

async function deleteItem(arm: Arm, cfg: Config, item: CleanupItem, deadline: number): Promise<ItemResult> {
  const api = await apiVersionFor(arm, item.subscriptionId, item.type);
  const current = await arm.get(item.id, api);
  if (!current) return { item, outcome: "already_gone", detail: "Resource no longer exists" };
  const blocker = await stillEligible(arm, cfg, item, current);
  if (blocker) return { item, outcome: "skipped", detail: blocker };
  const result = await arm.delete(item.id, api, deadline);
  if (result === "pending") return { item, outcome: "pending", detail: "Delete accepted; still running in Azure" };
  return { item, outcome: result === "deleted" ? "deleted" : "already_gone", detail: "Deleted" };
}

async function releaseCidr(arm: Arm, cfg: Config, item: CleanupItem, by: string): Promise<ItemResult> {
  const rgPath = `/subscriptions/${item.subscriptionId}/resourceGroups/${item.rgName}`;
  if (await arm.get(rgPath, API.resources)) {
    return { item, outcome: "skipped", detail: "Resource group exists again" };
  }
  const alloc = activeAllocations().find(
    (a) => a.cidr === item.cidr && a.rgId.toLowerCase() === item.id.toLowerCase(),
  );
  if (!alloc) return { item, outcome: "already_gone", detail: "Allocation already released" };
  releaseAllocation(alloc, by, lockGranule(cfg));
  return { item, outcome: "released", detail: `Released ${item.cidr}` };
}

function record(d: PlanDecision, r: ItemResult) {
  addRecord("deletions", {
    ts: nowIso(), planId: d.planId, resourceId: r.item.id, kind: r.item.kind, reason: r.item.reason,
    action: r.item.action, outcome: r.outcome, detail: r.detail, approvedBy: d.by, approvedAt: d.at,
  });
  const outcome = ["deleted", "released"].includes(r.outcome) ? "success"
    : r.outcome === "failed" ? "failure" : "skipped";
  audit(r.item.action === "delete" ? "resource_deleted" : "cidr_released", r.item.id, outcome, {
    plan_id: d.planId, approved_by: d.by, approved_at: d.at, result: r.outcome, detail: r.detail,
  });
}

async function processItem(arm: Arm, cfg: Config, d: PlanDecision, item: CleanupItem, deadline: number) {
  if (Date.now() > deadline) {
    return { item, outcome: "deferred", detail: "Time budget exhausted; it will reappear in the next scan" } as ItemResult;
  }
  try {
    return item.action === "release_cidr"
      ? await releaseCidr(arm, cfg, item, d.by)
      : await deleteItem(arm, cfg, item, deadline);
  } catch (err) {
    return { item, outcome: "failed", detail: (err as Error).message.slice(0, 300) } as ItemResult;
  }
}

async function execute(arm: Arm, cfg: Config, d: PlanDecision, items: CleanupItem[]) {
  const deadline = Date.now() + BUDGET_MS;
  const rgLast = (i: CleanupItem) => Number(i.kind.endsWith("_rg"));
  const ordered = [...items].sort((a, b) => rgLast(a) - rgLast(b));
  const results: ItemResult[] = [];
  for (const item of ordered) {
    const r = await processItem(arm, cfg, d, item, deadline);
    log(r.outcome === "failed" ? "error" : "info", "item_processed", "Processed cleanup item.", {
      id: item.id, kind: item.kind, outcome: r.outcome,
    });
    record(d, r);
    results.push(r);
  }
  return results;
}

function countOutcomes(results: ItemResult[]) {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  return counts;
}

function slackMessage(d: PlanDecision, results: ItemResult[] | null) {
  if (!results) {
    return { kind: "cleanup_rejected", text: `Cleanup plan ${d.planId} rejected by ${d.by}; nothing deleted.` };
  }
  const summary = Object.entries(countOutcomes(results)).map(([k, n]) => `${k}: ${n}`).join(" · ");
  const issues = results
    .filter((r) => !["deleted", "released", "already_gone"].includes(r.outcome))
    .slice(0, 20)
    .map((r) => `• ${r.item.id.split("/").pop()} — *${r.outcome}*: ${r.detail}`);
  return {
    kind: "cleanup_results",
    text: `Cleanup plan ${d.planId} executed (approved by ${d.by}): ${summary}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: ":white_check_mark: Azure cleanup results" } },
      { type: "section", text: { type: "mrkdwn", text: `*Plan* \`${d.planId}\` approved by ${d.by}\n${summary}` } },
      ...(issues.length ? [{ type: "section", text: { type: "mrkdwn", text: issues.join("\n") } }] : []),
    ],
  };
}

main("Execute cleanup", async () => {
  const d = readDecision(await Bun.stdin.text());
  if (!d) return;
  log("info", "execute_started", "Applying cleanup decision.", { plan_id: d.planId, decision: d.decision });

  const plan = readPlan(d.planId);
  const status = plan ? planStatus(plan) : "missing";
  if (!plan || status !== "pending") {
    log("warn", "plan_not_pending", "Plan missing or no longer pending; ignoring.", { plan_id: d.planId, status });
    audit("cleanup_decision", d.planId, "skipped", { decision: d.decision, by: d.by, status });
    return;
  }

  if (d.decision === "reject") {
    saveDecision(d);
    audit("cleanup_decision", d.planId, "success", { decision: "reject", by: d.by });
    log("info", "execute_completed", "Plan rejected; nothing deleted.", { plan_id: d.planId });
    process.stdout.write(JSON.stringify(slackMessage(d, null)));
    return;
  }

  audit("cleanup_decision", d.planId, "success", { decision: "approve", by: d.by });
  const cfg = loadConfig();
  const { arm } = createClients(cfg, { writable: true });
  const results = await execute(arm, cfg, d, plan.items);
  const counts = countOutcomes(results);
  saveDecision({ ...d, results: counts });

  log("info", "execute_completed", "Cleanup plan executed.", { plan_id: d.planId, ...counts });
  process.stdout.write(JSON.stringify(slackMessage(d, results)));
});
