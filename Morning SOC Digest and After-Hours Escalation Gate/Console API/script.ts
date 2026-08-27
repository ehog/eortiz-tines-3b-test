import { Database } from "bun:sqlite";
import {
  DEFAULT_CONFIG,
  decideAlert,
  getClockMode,
  getConfig,
  httpResponse,
  listAssets,
  logEvent,
  openWritable,
  pageOnCall,
  pagePayload,
  parseInput,
  recordDecision,
  saveAlert,
  saveConfig,
  SEED_ASSETS,
  type Alert,
  type ClockMode,
} from "./soclib";
import { SCENARIOS } from "./scenarios";
import { backlogAlerts } from "./backlog";

const raw = await Bun.stdin.text();
const { body, method } = parseInput(raw);
const branch = process.env._3B_BRANCH_ID ? `/__3b/branch/${process.env._3B_BRANCH_ID}` : "";

const db = openWritable();

function state() {
  const config = getConfig(db);
  const counters = Object.fromEntries(
    db
      .query<{ decision: string; n: number }, []>("SELECT decision, COUNT(*) AS n FROM gate_decisions GROUP BY decision")
      .all()
      .map((r) => [r.decision, r.n]),
  ) as Record<string, number>;

  const decisions = db
    .query<
      {
        alert_id: string;
        decided_at: string;
        decision: string;
        score: number;
        threshold: number;
        after_hours: number;
        clock_mode: string;
        reason: string;
        breakdown: string;
        replayed: number;
        alert_json: string;
        source: string;
        title: string;
      },
      []
    >(
      `SELECT d.*, a.json AS alert_json, a.source, a.title
         FROM gate_decisions d JOIN alerts a ON a.id = d.alert_id
        ORDER BY d.decided_at DESC, d.alert_id DESC LIMIT 150`,
    )
    .all()
    .map((r) => ({
      alertId: r.alert_id,
      decidedAt: r.decided_at,
      decision: r.decision,
      score: r.score,
      threshold: r.threshold,
      afterHours: r.after_hours === 1,
      clockMode: r.clock_mode,
      reason: r.reason,
      breakdown: JSON.parse(r.breakdown),
      replayed: r.replayed === 1,
      alert: JSON.parse(r.alert_json) as Alert,
    }));

  const pages = db
    .query<
      {
        id: string;
        alert_id: string;
        created_at: string;
        status: string;
        on_call: string;
        score: number;
        payload: string;
        slack_channel: string | null;
        slack_ts: string | null;
        slack_error: string | null;
        acked_at: string | null;
        resolved_at: string | null;
        title: string;
      },
      []
    >(
      `SELECT p.*, a.title FROM paged_events p JOIN alerts a ON a.id = p.alert_id
        ORDER BY p.created_at DESC LIMIT 60`,
    )
    .all()
    .map((r) => ({
      id: r.id,
      alertId: r.alert_id,
      title: r.title,
      createdAt: r.created_at,
      status: r.status,
      onCall: r.on_call,
      score: r.score,
      payload: JSON.parse(r.payload),
      slackChannel: r.slack_channel,
      slackTs: r.slack_ts,
      slackError: r.slack_error,
      ackedAt: r.acked_at,
      resolvedAt: r.resolved_at,
    }));

  const deferredQueue = db
    .query<{ alert_id: string; queued_at: string; score: number; reason: string; digested_at: string | null; alert_json: string }, []>(
      `SELECT q.*, a.json AS alert_json FROM deferred_queue q JOIN alerts a ON a.id = q.alert_id
        ORDER BY q.score DESC, q.queued_at DESC LIMIT 100`,
    )
    .all()
    .map((r) => ({
      alertId: r.alert_id,
      queuedAt: r.queued_at,
      score: r.score,
      reason: r.reason,
      digestedAt: r.digested_at,
      alert: JSON.parse(r.alert_json) as Alert,
    }));

  const digests = db
    .query<
      {
        id: number;
        created_at: string;
        status: string;
        window_start: string | null;
        window_end: string | null;
        item_count: number;
        markdown: string;
        html: string;
        slack_text: string;
        json: string;
        email_status: string | null;
        slack_status: string | null;
      },
      []
    >("SELECT * FROM digests ORDER BY id DESC LIMIT 5")
    .all()
    .map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      status: r.status,
      windowStart: r.window_start,
      windowEnd: r.window_end,
      itemCount: r.item_count,
      markdown: r.markdown,
      html: r.html,
      slackText: r.slack_text,
      meta: JSON.parse(r.json || "{}"),
      emailStatus: r.email_status,
      slackStatus: r.slack_status,
    }));

  const timeline = db
    .query<{ id: number; at: string; kind: string; message: string; meta: string }, []>(
      "SELECT * FROM timeline ORDER BY id DESC LIMIT 80",
    )
    .all()
    .map((r) => ({ id: r.id, at: r.at, kind: r.kind, message: r.message, meta: JSON.parse(r.meta || "{}") }));

  return {
    config,
    defaults: DEFAULT_CONFIG,
    clockMode: getClockMode(db),
    assets: listAssets(db),
    scenarios: SCENARIOS.map((s) => ({ id: s.id, name: s.name, description: s.description, alertCount: s.alerts.length })),
    counters: {
      received: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM alerts").get()?.n ?? 0,
      paged: counters.page ?? 0,
      deferred: counters.deferred ?? 0,
      suppressed: counters.suppressed ?? 0,
      bypassed: counters.bypass_business_hours ?? 0,
      pendingDeferred: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM deferred_queue WHERE digested_at IS NULL").get()?.n ?? 0,
      openPages: db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM paged_events WHERE status = 'triggered'").get()?.n ?? 0,
    },
    decisions,
    pages,
    deferredQueue,
    digests,
    timeline,
    routes: { testAlert: `${branch}/api/test-alert`, runDigest: `${branch}/api/run-digest`, console: `${branch}/api/console` },
  };
}

function respond(status: number, statusText: string, payload: unknown): never {
  console.log(httpResponse(status, statusText, JSON.stringify(payload)));
  db.close();
  process.exit(0);
}

if (method === "GET" || method === "LINK") {
  respond(200, "OK", state());
}

if (method !== "POST") {
  respond(405, "Method Not Allowed", { error: `Unsupported method ${method}` });
}

const req = (body ?? {}) as Record<string, any>;
const action = String(req.action ?? "");
const actor = /^x-3b-authenticated-email:\s*(.+)$/im.exec(raw)?.[1]?.trim() ?? "unknown";
const nowIso = new Date().toISOString();

async function replayAlert(alertId: string | undefined) {
  const row = alertId
    ? db.query<{ json: string }, [string]>("SELECT json FROM alerts WHERE id = ?").get(alertId)
    : db.query<{ json: string }, []>("SELECT json FROM alerts ORDER BY received_at DESC, id DESC LIMIT 1").get();
  if (!row) return { replayed: false as const, message: "No alert available to replay." };
  const alert = JSON.parse(row.json) as Alert;
  const config = getConfig(db);
  const result = decideAlert(alert, config, listAssets(db), getClockMode(db));
  recordDecision(db, alert, result, true);
  if (result.decision === "page") await pageOnCall(db, alert, result, config);
  logEvent(db, nowIso, "replay", `Replayed ${alert.id} with current config → ${result.decision} (${result.score})`, {
    alertId: alert.id,
    decision: result.decision,
    score: result.score,
    actor,
  });
  return { replayed: true as const, alertId: alert.id, decision: result.decision, score: result.score, reason: result.reason };
}

function resetDemo(db: Database, preload: boolean) {
  for (const table of ["gate_decisions", "deferred_queue", "paged_events", "alerts", "digests", "timeline"]) {
    db.exec(`DELETE FROM ${table}`);
  }
  db.query("UPDATE config SET json = ? WHERE id = 1").run(JSON.stringify(DEFAULT_CONFIG));
  db.query("UPDATE demo_clock SET mode = 'real', updated_at = ? WHERE id = 1").run(nowIso);
  db.exec("DELETE FROM critical_assets");
  const insert = db.query(
    "INSERT INTO critical_assets (hostname, tier, owner, business_service, business_impact, notes) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const a of SEED_ASSETS) insert.run(a.hostname, a.tier, a.owner, a.businessService, a.businessImpact, a.notes);

  let seeded = 0;
  if (preload) {
    const config = getConfig(db);
    const assets = listAssets(db);
    const insertPage = db.query(
      `INSERT INTO paged_events (id, alert_id, created_at, status, on_call, score, payload, slack_channel, slack_ts, slack_error, acked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    );
    for (const alert of backlogAlerts(new Date())) {
      saveAlert(db, alert);
      // The backlog represents overnight traffic, so it is judged against the after-hours rules.
      const result = decideAlert(alert, config, assets, "after_hours");
      recordDecision(db, alert, result);
      if (result.decision === "page") {
        // Seeded pages skip Slack: the backlog is historical, so no notifications are re-sent.
        const acknowledged = seeded % 3 === 0;
        insertPage.run(
          `PD-${alert.id}`,
          alert.id,
          alert.receivedAt,
          acknowledged ? "acknowledged" : "triggered",
          config.delivery.onCallName,
          result.score,
          JSON.stringify(pagePayload(alert, result, config)),
          config.delivery.slackChannel,
          acknowledged ? new Date(new Date(alert.receivedAt).getTime() + 240_000).toISOString() : null,
        );
      }
      seeded += 1;
    }
  }
  logEvent(db, nowIso, "reset", `Demo state reset${preload ? ` with ${seeded} backlog alerts` : ""}`, { actor, preload });
  return seeded;
}

switch (action) {
  case "save_config": {
    const config = saveConfig(db, req.config);
    logEvent(db, nowIso, "config", `Gate configuration updated (threshold ${config.pageThreshold})`, { actor });
    respond(200, "OK", { ok: true, message: `Configuration saved · page threshold ${config.pageThreshold}`, state: state() });
    break;
  }
  case "set_clock": {
    const mode = String(req.mode) as ClockMode;
    if (!["real", "after_hours", "business_hours"].includes(mode)) respond(400, "Bad Request", { error: "Invalid clock mode" });
    db.query("UPDATE demo_clock SET mode = ?, updated_at = ? WHERE id = 1").run(mode, nowIso);
    logEvent(db, nowIso, "clock", `Demo clock set to ${mode.replace(/_/g, " ")}`, { actor, mode });
    respond(200, "OK", { ok: true, message: `Clock mode: ${mode.replace(/_/g, " ")}`, state: state() });
    break;
  }
  case "upsert_asset": {
    const a = (req.asset ?? {}) as Record<string, string>;
    const hostname = String(a.hostname ?? "").trim().toLowerCase();
    if (!hostname) respond(400, "Bad Request", { error: "hostname is required" });
    db.query(
      `INSERT INTO critical_assets (hostname, tier, owner, business_service, business_impact, notes)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(hostname) DO UPDATE SET tier = excluded.tier, owner = excluded.owner,
         business_service = excluded.business_service, business_impact = excluded.business_impact, notes = excluded.notes`,
    ).run(
      hostname,
      ["tier0", "tier1", "tier2", "tier3"].includes(String(a.tier)) ? String(a.tier) : "tier2",
      String(a.owner ?? "Unassigned"),
      String(a.businessService ?? "Unmapped"),
      ["revenue_impacting", "customer_data", "internal_only", "none"].includes(String(a.businessImpact))
        ? String(a.businessImpact)
        : "internal_only",
      String(a.notes ?? ""),
    );
    logEvent(db, nowIso, "cmdb", `CMDB entry saved for ${hostname}`, { actor, hostname });
    respond(200, "OK", { ok: true, message: `Saved ${hostname} in the mock CMDB`, state: state() });
    break;
  }
  case "delete_asset": {
    const hostname = String(req.hostname ?? "").trim().toLowerCase();
    db.query("DELETE FROM critical_assets WHERE hostname = ?").run(hostname);
    logEvent(db, nowIso, "cmdb", `CMDB entry removed for ${hostname}`, { actor, hostname });
    respond(200, "OK", { ok: true, message: `Removed ${hostname} from the mock CMDB`, state: state() });
    break;
  }
  case "ack_page":
  case "resolve_page": {
    const id = String(req.id ?? "");
    const acking = action === "ack_page";
    db.query(
      acking
        ? "UPDATE paged_events SET status = 'acknowledged', acked_at = ? WHERE id = ?"
        : "UPDATE paged_events SET status = 'resolved', resolved_at = ? WHERE id = ?",
    ).run(nowIso, id);
    logEvent(db, nowIso, "page:update", `${acking ? "Acknowledged" : "Resolved"} page ${id}`, { actor, pageId: id });
    respond(200, "OK", { ok: true, message: `${acking ? "Acknowledged" : "Resolved"} ${id}`, state: state() });
    break;
  }
  case "clear_pages": {
    db.exec("DELETE FROM paged_events");
    logEvent(db, nowIso, "page:update", "Cleared the mock PagerDuty inbox", { actor });
    respond(200, "OK", { ok: true, message: "Page inbox cleared", state: state() });
    break;
  }
  case "replay_last": {
    const outcome = await replayAlert(req.alertId);
    respond(200, "OK", {
      ok: outcome.replayed,
      message: outcome.replayed
        ? `Replayed ${outcome.alertId} → ${outcome.decision} (score ${outcome.score})`
        : outcome.message,
      replay: outcome,
      state: state(),
    });
    break;
  }
  case "reset_demo": {
    const seeded = resetDemo(db, req.preloadBacklog !== false);
    respond(200, "OK", {
      ok: true,
      message: seeded ? `Demo reset with ${seeded} overnight backlog alerts` : "Demo reset to defaults",
      state: state(),
    });
    break;
  }
  default:
    respond(400, "Bad Request", { error: `Unknown action "${action}"` });
}
