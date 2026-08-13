import { audit, drainEvents, ISSUE_STATUSES, openWritable } from "./db";
import { parseBody, parseRequest } from "./http";

type JiraEvent = {
  user?: { emailAddress?: string };
  issue?: { key?: string; fields?: { status?: { name?: string } } };
  changelog?: {
    items?: Array<{ field?: string; fromString?: string; toString?: string }>;
  };
};

const raw = await Bun.stdin.text();
const req = parseRequest(raw);
const posted =
  req && req.method.toUpperCase() === "POST" && req.body.trim().startsWith("{");

const db = openWritable();

const source = posted ? "jira_webhook" : "jira_mock";
const events: JiraEvent[] = posted
  ? [parseBody(req!.body) as JiraEvent]
  : (drainEvents(db, "issue.transitioned") as JiraEvent[]);

const decisions = events.flatMap((event) => {
  const key = event.issue?.key;
  const item = (event.changelog?.items ?? []).find(
    (candidate) => candidate.field === "status",
  );
  const to = item?.toString ?? event.issue?.fields?.status?.name;
  if (!key || !to || !ISSUE_STATUSES.includes(to)) return [];
  if (to !== "Allow" && to !== "Deny") {
    console.error(`ignoring ${key} transition to ${to}`);
    return [];
  }
  audit(db, event.user?.emailAddress ?? "jira", "decision.received", key, {
    to,
    source,
  });
  return [
    {
      issue_key: key,
      decision: to,
      approver: event.user?.emailAddress ?? "unknown@example.com",
      source,
    },
  ];
});

if (decisions.length === 0) {
  console.error("no actionable status transitions");
  process.exit(0);
}

console.log(JSON.stringify({ decisions }));
