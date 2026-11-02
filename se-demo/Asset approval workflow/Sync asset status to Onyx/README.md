Writes the Jira decision back into Onyx — the last hop of the flow. Triggered by [Jira webhook](<../Jira webhook/README.md>) or [Poll Jira tickets](<../Poll Jira tickets/README.md>); input is `{"decisions": [{ "issue_key", "decision", "approver" }]}`.

`Allow` → asset `allowed`, `Deny` → asset `denied`. Idempotent: an asset already in the target status is reported as `no_change` and not rewritten, and an unknown issue key is reported as `asset_not_found` rather than failing the run. Every real change writes an `asset.status_synced` audit row.

Today it updates `/storage/mock_state/mock.db` directly. When the real Onyx API arrives, replace the `UPDATE` in [script.ts](script.ts) with a `PATCH` to Onyx and attach an Onyx connector to this step — nothing upstream changes.
