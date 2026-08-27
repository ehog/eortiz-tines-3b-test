import { parseRequest, respond, jsonBody, type Req } from "./http";
import {
  openWrite,
  listTickets,
  toRecord,
  addWorkNote,
  updateTicket,
  createTicket,
  priorityFor,
  OPEN_STATES,
} from "./snow-db";
import { seedHistory } from "./seed-history";
import { openRead as openPipeline, demoNow } from "./pipeline-db";

function main(raw: string): void {
  const req: Req = parseRequest(raw);
  const db = openWrite();
  const now = demoNow(openPipeline());

  if (req.method === "GET") {
    const sysId = req.query.get("sys_id") ?? undefined;
    const state = (req.query.get("state") ?? "all") as "open" | "closed" | "all";
    const rows = listTickets(db, {
      sysId,
      state,
      team: req.query.get("team") ?? undefined,
    });
    const records = rows.map((r) => toRecord(db, r, now));
    respond(200, {
      result: records,
      count: records.length,
      as_of: now.toISOString(),
      open_count: records.filter((r) => r.state !== "closed").length,
      overdue_count: records.filter((r) => r.overdue).length,
    });
    return;
  }

  if (req.method === "POST") {
    const body = jsonBody(req);
    const action = String(body.action ?? "create");

    if (action === "reset") {
      db.transaction(() => {
        db.run("DELETE FROM work_notes");
        db.run("DELETE FROM tickets");
        db.run("DELETE FROM meta WHERE key = 'last_number'");
      })();
      respond(200, { result: { action, cleared: true } });
      return;
    }

    if (action === "seed_history") {
      const count = Number(body.count ?? 18);
      const created = seedHistory(db, now, Number.isFinite(count) ? count : 18);
      respond(201, { result: { action, created } });
      return;
    }

    if (action === "comment") {
      const sysId = String(body.sys_id ?? "");
      const row = listTickets(db, { sysId })[0];
      if (!row) {
        respond(404, { error: { message: `no change with sys_id '${sysId}'` } });
        return;
      }
      addWorkNote(
        db,
        sysId,
        String(body.note ?? ""),
        String(body.author ?? "vuln-automation"),
        now.toISOString(),
      );
      respond(201, { result: toRecord(db, listTickets(db, { sysId })[0]!, now) });
      return;
    }

    if (action === "create") {
      const band = String(body.risk_band ?? "medium");
      const created = createTicket(db, {
        short_description: String(body.short_description ?? "Vulnerability remediation change"),
        description: String(body.description ?? ""),
        assignment_group: String(body.assignment_group ?? "CAB-Security-Operations"),
        team: String(body.team ?? "Security Operations"),
        application: String(body.application ?? "Unattributed Assets"),
        priority: Number(body.priority ?? priorityFor(band)),
        risk_score: Number(body.risk_score ?? 0),
        risk_band: band,
        due_date: String(body.due_date ?? new Date(now.getTime() + 30 * 86_400_000).toISOString()),
        opened_at: now.toISOString(),
        finding_ids: Array.isArray(body.finding_ids) ? (body.finding_ids as string[]) : [],
        payload: body.payload ?? {},
      });
      addWorkNote(db, created.sys_id, "Change created via the mock ServiceNow API.", "api", now.toISOString());
      respond(201, { result: toRecord(db, created, now) });
      return;
    }

    respond(400, {
      error: {
        message: `unknown action '${action}'`,
        valid_actions: ["create", "comment", "seed_history", "reset"],
      },
    });
    return;
  }

  if (req.method === "PATCH") {
    const body = jsonBody(req);
    const sysId = String(body.sys_id ?? "");
    const row = listTickets(db, { sysId })[0];
    if (!row) {
      respond(404, { error: { message: `no change with sys_id '${sysId}'` } });
      return;
    }
    if (body.action === "close") {
      if (row.state === "closed") {
        respond(200, { result: toRecord(db, row, now), note: "change was already closed" });
        return;
      }
      updateTicket(db, sysId, { state: "closed", closed_at: now.toISOString() }, now.toISOString());
      addWorkNote(
        db,
        sysId,
        String(body.note ?? "Remediation complete; verified by rescan. Change closed."),
        String(body.author ?? "change-owner"),
        now.toISOString(),
      );
      respond(200, { result: toRecord(db, listTickets(db, { sysId })[0]!, now) });
      return;
    }
    const patch: Record<string, string | number | null> = {};
    if (typeof body.state === "string" && [...OPEN_STATES, "closed"].includes(body.state as never)) {
      patch.state = body.state;
    }
    if (body.priority !== undefined) patch.priority = Number(body.priority);
    if (body.due_date !== undefined) patch.due_date = String(body.due_date);
    if (body.short_description !== undefined) {
      patch.short_description = String(body.short_description);
    }
    if (body.description !== undefined) patch.description = String(body.description);
    if (!Object.keys(patch).length) {
      respond(400, {
        error: {
          message: "no updatable fields supplied",
          updatable: ["state", "priority", "due_date", "short_description", "description"],
        },
      });
      return;
    }
    updateTicket(db, sysId, patch, now.toISOString());
    respond(200, { result: toRecord(db, listTickets(db, { sysId })[0]!, now) });
    return;
  }

  respond(405, { error: { message: `method ${req.method} not allowed` } });
}

try {
  main(await Bun.stdin.text());
} catch (err) {
  console.error(err instanceof Error ? err.stack : String(err));
  respond(400, { error: { message: err instanceof Error ? err.message : String(err) } });
}
