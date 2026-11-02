import { API, type Arm, createClients } from "./arm";
import { type Config, ensureConfigFile, isDoNotDelete, isProtectedRg, loadConfig } from "./config";
import { audit, log, main } from "./log";
import { type CleanupItem, ORPHAN_COLLECTIONS, expiredReason, orphanReason, parseId } from "./rules";
import { activeAllocations, keyOf, nowIso, pruneOlderThan, readJson, savePlan, writeJson } from "./store";

const DAY_MS = 86_400_000;
const RECORD_RETENTION_DAYS = 180;

interface Scan {
  items: CleanupItem[];
  excluded: number;
}

function exclude(scan: Scan, id: string, why: string) {
  scan.excluded++;
  log("warn", "item_excluded", "Candidate is protected; not flagging.", { id, why });
}

function add(scan: Scan, item: CleanupItem) {
  if (scan.items.some((i) => i.id.toLowerCase() === item.id.toLowerCase())) return;
  scan.items.push(item);
}

function trackEmptiness(rgId: string, empty: boolean): string | null {
  const path = `rg-inventory/${keyOf(rgId)}.json`;
  const prev = readJson(path);
  const emptySince = empty ? (prev?.emptySince ?? nowIso()) : null;
  if (!prev || prev.emptySince !== emptySince) {
    writeJson(path, { rgId, firstSeen: prev?.firstSeen ?? nowIso(), emptySince });
  }
  return emptySince;
}

async function scanSubscription(arm: Arm, cfg: Config, sub: string, scan: Scan) {
  const today = nowIso().slice(0, 10);
  const rgs = await arm.list(`/subscriptions/${sub}/resourcegroups`, API.resources);
  const rgByName = new Map(rgs.map((rg: any) => [rg.name.toLowerCase(), rg]));
  const consider = (r: any, kind: CleanupItem["kind"], reason: string) => {
    const { rgName } = parseId(r.id);
    if (isDoNotDelete(r.tags)) return exclude(scan, r.id, "do-not-delete tag");
    if (isProtectedRg(cfg, rgName, rgByName.get(rgName.toLowerCase())?.tags)) {
      return exclude(scan, r.id, "protected resource group");
    }
    add(scan, { id: r.id, kind, action: "delete", reason, subscriptionId: sub, rgName, type: r.type });
  };

  for (const c of ORPHAN_COLLECTIONS) {
    const resources = await arm.list(`/subscriptions/${sub}/providers/${c.type}`, c.api);
    for (const r of resources) {
      const reason = orphanReason(c.kind, r);
      if (reason) consider(r, c.kind, reason);
    }
  }

  const all = await arm.list(`/subscriptions/${sub}/resources`, API.resources);
  for (const r of all) {
    const reason = expiredReason(r.tags, today);
    if (reason) consider(r, "expired_resource", reason);
  }

  const minAge = cfg.emptyRgMinAgeDays * DAY_MS;
  for (const rg of rgs) {
    const prefix = rg.id.toLowerCase() + "/";
    const empty = !all.some((r: any) => r.id.toLowerCase().startsWith(prefix));
    const emptySince = trackEmptiness(rg.id, empty);
    const expired = expiredReason(rg.tags, today);
    const oldEmpty = !!emptySince && Date.now() - Date.parse(emptySince) >= minAge;
    if (!expired && !oldEmpty) continue;
    if (isProtectedRg(cfg, rg.name, rg.tags)) {
      exclude(scan, rg.id, "protected resource group");
      continue;
    }
    const reason = expired ?? `Empty since ${emptySince!.slice(0, 10)} (≥ ${cfg.emptyRgMinAgeDays} days)`;
    add(scan, {
      id: rg.id, kind: expired ? "expired_rg" : "empty_rg", action: "delete",
      reason, subscriptionId: sub, rgName: rg.name, type: rg.type,
    });
  }

  const allocations = activeAllocations().filter((a) => a.subscriptionId === sub);
  for (const a of allocations) {
    if (rgByName.has(a.rgName.toLowerCase())) continue;
    add(scan, {
      id: a.rgId, kind: "ipam_release", action: "release_cidr",
      reason: `Auto-provisioned RG was deleted; release ${a.cidr}`,
      subscriptionId: sub, rgName: a.rgName, type: "ipam/allocation", cidr: a.cidr,
    });
  }
}

function summarize(items: CleanupItem[]) {
  const byKind: Record<string, number> = {};
  for (const i of items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  return byKind;
}

function slackMessage(planId: string, items: CleanupItem[], excluded: number, truncated: number) {
  const base = `${process.env._3B_WORKFLOW_BASE_URL}/azure-rg/cleanup?plan=${planId}`;
  const lines = items.slice(0, 25).map((i) => `• \`${i.rgName}\` ${i.id.split("/").pop()} — ${i.reason}`);
  const more = items.length > 25 ? `\n…and ${items.length - 25} more` : "";
  const counts = Object.entries(summarize(items)).map(([k, n]) => `${k}: ${n}`).join(" · ");
  const note = truncated ? `\n_${truncated} more candidates deferred to the next run._` : "";
  return {
    kind: "cleanup_plan",
    text: `Dry run: ${items.length} item(s) would be cleaned up (plan ${planId}). Review: ${base}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: ":broom: Azure cleanup — dry run" } },
      { type: "section", text: { type: "mrkdwn", text: `*Plan* \`${planId}\` — ${counts}\nProtected/excluded: ${excluded}${note}` } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n") + more } },
      {
        type: "actions",
        elements: [
          { type: "button", style: "primary", text: { type: "plain_text", text: "Approve" }, url: `${base}&decision=approve` },
          { type: "button", style: "danger", text: { type: "plain_text", text: "Reject" }, url: `${base}&decision=reject` },
        ],
      },
    ],
  };
}

function prune() {
  const removed =
    pruneOlderThan("provisioning", RECORD_RETENTION_DAYS) +
    pruneOlderThan("compliance", RECORD_RETENTION_DAYS);
  if (removed) log("info", "records_pruned", "Pruned old provisioning/compliance records.", { count: removed });
}

main("Cleanup scan", async () => {
  ensureConfigFile();
  const cfg = loadConfig();
  log("info", "scan_started", "Scanning subscriptions for cleanup candidates.", {
    subscriptions: cfg.subscriptions.length, simulate: cfg.simulate,
  });
  const { arm } = createClients(cfg, { writable: true });

  const scan: Scan = { items: [], excluded: 0 };
  for (const sub of cfg.subscriptions) await scanSubscription(arm, cfg, sub, scan);
  prune();

  const truncated = Math.max(0, scan.items.length - cfg.maxCleanupItems);
  const items = scan.items.slice(0, cfg.maxCleanupItems);
  if (!items.length) {
    log("info", "scan_completed", "Nothing to clean up.", { excluded: scan.excluded });
    return;
  }

  const stampId = nowIso().replace(/[-:]/g, "").slice(0, 15);
  const planId = `cp-${stampId}-${crypto.randomUUID().slice(0, 6)}`;
  const summary = { byKind: summarize(items), excluded: scan.excluded, truncated };
  savePlan({ id: planId, createdAt: nowIso(), items, summary });

  audit("cleanup_plan_created", planId, "success", summary);
  log("info", "scan_completed", "Created dry-run cleanup plan.", { plan_id: planId, count: items.length, ...summary });
  process.stdout.write(JSON.stringify(slackMessage(planId, items, scan.excluded, truncated)));
});
