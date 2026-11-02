Triggered by manual runs or the configured 15-minute cron after publication. Uses the attached Jira connector to GET `/rest/api/3/search/jql` for open, opted-in KAN (Solution Engineering) tickets: `project = KAN AND labels = "agent-ready" AND statusCategory != Done ORDER BY updated ASC`.

Adds mandatory project/label predicates, reads at most 10 issues per execution, and saves a next-page cursor. Emits `{kind:"intake",source:"poll",keys:[...]}` to Prepare ticket; an empty list is normal when no tickets are eligible. Failed polling produces an explicit terminal error. Cursor and audit records persist. No Jira writes occur. Fixture mode still exits without calls if re-enabled.

Settings originate in [Prepare ticket/settings.json](<../Prepare ticket/settings.json>); synchronize all copies after changes. Connector-backed validation returned HTTP 200 and zero eligible tickets. The schedule change remains draft-only until publication.
