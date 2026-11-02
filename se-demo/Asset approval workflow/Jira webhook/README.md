Normalizes a Jira status change into an approval decision. Two ways in:

- `POST /jira/webhook` (`external_id` auth) — where a real Jira automation rule would post its `jira:issue_updated` payload.
- Linked from [Jira mock API](<../Jira mock API/README.md>) — drains queued `issue.transitioned` events.

Only `status` transitions to `Allow` or `Deny` are kept; anything else is logged and dropped, producing no output. Output for [Sync asset status to Onyx](<../Sync asset status to Onyx/README.md>):

```json
{ "decisions": [{ "issue_key": "AIGOV-1", "decision": "Allow", "approver": "admin@example.com", "source": "jira_webhook" }] }
```

Records a `decision.received` audit row in `/storage/mock_state/mock.db`. Logic in [script.ts](script.ts).
