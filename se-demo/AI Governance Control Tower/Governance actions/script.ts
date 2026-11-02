const VOL = "/storage/ai_governance";
const raw = await Bun.stdin.text();

const headerEnd = raw.indexOf("\r\n\r\n") >= 0 ? raw.indexOf("\r\n\r\n") + 4 : raw.indexOf("\n\n") + 2;
const head = raw.slice(0, Math.max(0, headerEnd));
const body = raw.slice(Math.max(0, headerEnd));
const actor =
  head
    .split(/\r?\n/)
    .find((l) => l.toLowerCase().startsWith("x-3b-authenticated-email:"))
    ?.split(":")[1]
    ?.trim() ?? "unknown@realchemistry.com";

function respond(status: string, payload: unknown) {
  const b = JSON.stringify(payload);
  process.stdout.write(
    [`HTTP/1.1 ${status}`, "Content-Type: application/json", "Cache-Control: no-store", `Content-Length: ${Buffer.byteLength(b)}`, "", b].join("\r\n"),
  );
}

let req: any;
try {
  req = JSON.parse(body || "{}");
} catch {
  respond("400 Bad Request", { error: "invalid_json" });
  process.exit(0);
}

const ACTIONS = new Set(["fix_decision", "tool_decision", "advance_stage"]);
if (!ACTIONS.has(req.action)) {
  respond("400 Bad Request", { error: "unknown_action", allowed: [...ACTIONS] });
  process.exit(0);
}

const now = new Date().toISOString();
const readJson = async (name: string) => {
  const f = Bun.file(`${VOL}/${name}`);
  return (await f.exists()) ? await f.json() : null;
};

const auditFile = (await readJson("audit.json")) ?? { append_only: true, records: [] };
let seq = auditFile.records.length ? auditFile.records[auditFile.records.length - 1].seq : 0;
const audit = (r: { action: string; item_id: string; field: string; prior_value: string | null; new_value: string; note: string }) => {
  auditFile.records.push({ seq: ++seq, at: now, actor, ...r });
};

let result: any;

if (req.action === "fix_decision") {
  const file = await readJson("suggestions.json");
  const s = file?.suggestions.find((x: any) => x.id === req.id);
  if (!s) {
    respond("404 Not Found", { error: "suggestion_not_found", id: req.id });
    process.exit(0);
  }
  const decision = req.decision === "approved" ? "approved" : "rejected";
  audit({
    action: `security fix ${decision}`,
    item_id: s.id,
    field: "decision",
    prior_value: s.decision,
    new_value: decision,
    note: `${s.title} on ${s.build_name}`,
  });
  s.decision = decision;
  s.decided_by = actor;
  s.decided_at = now;
  await Bun.write(`${VOL}/suggestions.json`, JSON.stringify(file, null, 2));
  result = { id: s.id, decision, decided_by: actor, decided_at: now };
}

if (req.action === "tool_decision") {
  const file = await readJson("shadow.json");
  const e = file?.entries.find((x: any) => x.domain === req.id);
  if (!e) {
    respond("404 Not Found", { error: "tool_not_found", id: req.id });
    process.exit(0);
  }
  const decision = req.decision === "allow" ? "allow" : "block";
  audit({
    action: `shadow AI tool ${decision === "block" ? "blocked" : "allowed"}`,
    item_id: e.domain,
    field: "decision",
    prior_value: e.decision,
    new_value: decision,
    note: `${e.tool} (${e.vendor}); risk ${e.risk}`,
  });
  file.changes.unshift({
    at: now,
    domain: e.domain,
    action: e.decision === "review" ? "added" : "moved",
    from: e.decision,
    to: decision,
    actor,
    note: req.note ?? "Decision recorded from the Control Tower.",
  });
  e.decision = decision;
  e.proposed = null;
  e.decided_by = actor;
  e.decided_at = now;
  await Bun.write(`${VOL}/shadow.json`, JSON.stringify(file, null, 2));
  result = { id: e.domain, decision, decided_by: actor, decided_at: now };
}

if (req.action === "advance_stage") {
  const file = await readJson("pipeline.json");
  const item = file?.items.find((x: any) => x.id === req.id);
  if (!item) {
    respond("404 Not Found", { error: "item_not_found", id: req.id });
    process.exit(0);
  }
  const lane: string[] = item.lane === "fast-track" ? file.fast_track_stages : file.stages;
  const idx = lane.indexOf(item.stage);
  const outcome = req.outcome === "killed" ? "killed" : req.outcome === "implemented" ? "implemented" : null;
  const next = outcome ? item.stage : lane[Math.min(idx + 1, lane.length - 1)];
  audit({
    action: outcome ? `governance item ${outcome}` : "governance stage advanced",
    item_id: item.id,
    field: outcome ? "outcome" : "stage",
    prior_value: outcome ? item.outcome : item.stage,
    new_value: outcome ?? next,
    note: req.note ?? `${item.subject} (${item.lane} lane)`,
  });
  if (outcome) item.outcome = outcome;
  else {
    item.stage = next;
    item.stage_entered_at = now;
    item.next_action = next === lane[lane.length - 1] ? "Decision required: implement with controls, or kill and revoke credentials." : `Awaiting ${next} sign-off.`;
  }
  await Bun.write(`${VOL}/pipeline.json`, JSON.stringify(file, null, 2));
  result = { id: item.id, stage: item.stage, outcome: item.outcome };
}

await Bun.write(`${VOL}/audit.json`, JSON.stringify({ generated_at: now, append_only: true, records: auditFile.records }, null, 2));
console.error(`${req.action} by ${actor} on ${req.id}`);
respond("200 OK", { ok: true, ...result, audit_seq: seq });
