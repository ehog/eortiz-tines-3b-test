import { openReadOnly } from "./db";

const db = openReadOnly();
if (!db) {
  console.error("no mock state yet");
  process.exit(0);
}

type Row = { issue_key: string; decision: string; approver: string };

const rows = db
  .query<Row, []>(
    `SELECT i.key AS issue_key,
            i.status AS decision,
            COALESCE(
              (SELECT c.author FROM issue_changelog c
                WHERE c.issue_key = i.key AND c.field = 'status'
                ORDER BY c.id DESC LIMIT 1),
              'unknown@example.com'
            ) AS approver
       FROM issues i
       JOIN assets a ON a.issue_key = i.key
      WHERE i.status IN ('Allow', 'Deny')
        AND a.status = 'pending_review'
      ORDER BY i.updated_at`,
  )
  .all();

if (rows.length === 0) {
  console.error("no pending decisions to reconcile");
  process.exit(0);
}

console.error(`reconciling ${rows.length} decision(s) missed by the webhook`);
console.log(
  JSON.stringify({
    decisions: rows.map((row) => ({ ...row, source: "jira_poll" })),
  }),
);
