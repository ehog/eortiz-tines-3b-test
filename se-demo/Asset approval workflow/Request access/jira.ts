import type { Database } from "bun:sqlite";
import { audit, type Issue, nextIssueKey, now } from "./db";

export function createIssue(
  db: Database,
  input: {
    assetId: string;
    summary: string;
    description: string;
    reporter: string;
  },
): Issue {
  const at = now();
  const issue: Issue = {
    key: nextIssueKey(db),
    asset_id: input.assetId,
    summary: input.summary,
    description: input.description,
    reporter: input.reporter,
    status: "Open",
    created_at: at,
    updated_at: at,
  };

  db.query(
    `INSERT INTO issues (key, asset_id, summary, description, reporter, status, created_at, updated_at)
     VALUES ($key, $asset_id, $summary, $description, $reporter, $status, $created_at, $updated_at)`,
  ).run({
    $key: issue.key,
    $asset_id: issue.asset_id,
    $summary: issue.summary,
    $description: issue.description,
    $reporter: issue.reporter,
    $status: issue.status,
    $created_at: issue.created_at,
    $updated_at: issue.updated_at,
  });
  audit(db, issue.reporter, "issue.created", issue.key, {
    asset_id: issue.asset_id,
  });

  return issue;
}

export function toJira(issue: Issue) {
  return {
    id: issue.key.replace(/\D/g, ""),
    key: issue.key,
    self: `/jira/api?resource=issue&key=${issue.key}`,
    fields: {
      summary: issue.summary,
      description: issue.description,
      reporter: { emailAddress: issue.reporter },
      status: { name: issue.status },
      created: issue.created_at,
      updated: issue.updated_at,
      customfield_asset_id: issue.asset_id,
    },
  };
}
