import {
  audit,
  emit,
  ISSUE_STATUSES,
  type Issue,
  now,
  openWritable,
  seed,
} from "./db";
import { json, parseBody, parseRequest, requester } from "./http";
import { createIssue, toJira } from "./jira";

const raw = await Bun.stdin.text();
const req = parseRequest(raw);
if (!req) {
  console.error("Jira mock API expects an HTTP request on stdin");
  process.exit(1);
}

const db = openWritable();
seed(db);

const segments = req.path.split("/").filter(Boolean);
const issueIndex = segments.indexOf("issue");
const issueKey =
  req.query.get("key") ??
  (issueIndex === -1 ? undefined : segments[issueIndex + 1]);
const isTransition =
  segments.includes("transitions") ||
  req.query.get("resource") === "transitions";
const isSearch =
  segments.includes("search") || req.query.get("resource") === "search";
const method = req.method.toUpperCase();

function respond(status: number, payload: unknown): never {
  process.stdout.write(json(status, payload));
  process.exit(0);
}

function getIssue(key: string): Issue | null {
  return (
    db.query<Issue, [string]>("SELECT * FROM issues WHERE key = ?").get(key) ??
    null
  );
}

if (isSearch && method === "GET") {
  const status = req.query.get("status");
  const issues = status
    ? db
        .query<Issue, [string]>(
          "SELECT * FROM issues WHERE status = ? ORDER BY created_at DESC",
        )
        .all(status)
    : db
        .query<Issue, []>("SELECT * FROM issues ORDER BY created_at DESC")
        .all();
  respond(200, { total: issues.length, issues: issues.map(toJira) });
}

if (isTransition && method === "POST") {
  if (!issueKey) respond(400, { error: "issue_key_required" });
  const issue = getIssue(issueKey);
  if (!issue) respond(404, { errorMessages: ["Issue does not exist"] });

  const body = parseBody(req.body);
  const transition = (body.transition ?? {}) as Record<string, unknown>;
  const target = String(
    transition.to ?? (transition as { name?: string }).name ?? body.status ?? "",
  );
  if (!ISSUE_STATUSES.includes(target)) {
    respond(400, { error: "invalid_transition", allowed: ISSUE_STATUSES });
  }

  const author = requester(req, String(body.author ?? "admin@example.com"));
  const at = now();

  if (target !== issue.status) {
    db.query("UPDATE issues SET status = ?, updated_at = ? WHERE key = ?").run(
      target,
      at,
      issue.key,
    );
    db.query(
      `INSERT INTO issue_changelog (issue_key, field, from_value, to_value, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(issue.key, "status", issue.status, target, author, at);
    audit(db, author, "issue.transitioned", issue.key, {
      from: issue.status,
      to: target,
    });
    emit(db, "issue.transitioned", {
      webhookEvent: "jira:issue_updated",
      timestamp: at,
      user: { emailAddress: author },
      issue: toJira({ ...issue, status: target, updated_at: at }),
      changelog: {
        items: [
          {
            field: "status",
            fieldtype: "jira",
            fromString: issue.status,
            toString: target,
          },
        ],
      },
    });
  }

  respond(200, { key: issue.key, status: target });
}

if (method === "POST") {
  const body = parseBody(req.body);
  const fields = (body.fields ?? body) as Record<string, unknown>;
  const assetId = String(
    fields.customfield_asset_id ?? fields.asset_id ?? "",
  ).trim();
  const summary = String(fields.summary ?? "").trim();
  if (!assetId) respond(400, { error: "asset_id_required" });
  if (!summary) respond(400, { error: "summary_required" });

  const issue = createIssue(db, {
    assetId,
    summary,
    description: String(fields.description ?? ""),
    reporter: requester(
      req,
      String(
        (fields.reporter as { emailAddress?: string })?.emailAddress ??
          fields.reporter ??
          "unknown@example.com",
      ),
    ),
  });

  respond(201, toJira(issue));
}

if (method === "GET") {
  if (!issueKey) respond(400, { error: "issue_key_required" });
  const issue = getIssue(issueKey);
  if (!issue) respond(404, { errorMessages: ["Issue does not exist"] });
  respond(200, toJira(issue));
}

respond(405, { error: "method_not_allowed", method });
