Stands in for the ServiceNow `change_request` table so changes, work notes and SLA state can be
demonstrated without a ServiceNow instance.

**Trigger** — `GET`/`POST`/`PATCH` on the space-private route `/qualys-remediation/mock/servicenow`.
See [api.json](api.json) for the full contract.

**Behaviour**

- `GET` returns ServiceNow-shaped records (`sys_id`, `number` like `CHG0031201`, `short_description`,
  `description`, `assignment_group`, `priority`, `state`, `due_date`, `closed_at`, work notes) with
  `days_to_due` and `overdue` evaluated against the demo clock. Filterable by `state`, `team` and
  `sys_id`.
- `POST` creates a change, appends a work note (`action:"comment"`), clears the table
  (`action:"reset"`), or backfills three weeks of opened and closed changes (`action:"seed_history"`)
  so the report and MTTR have data at the start of a demo. That history is generated from a fixed
  seed, so it is identical every time — see [seed-history.ts](seed-history.ts).
- `PATCH` updates a change or closes it with `{action:"close"}`, which stamps `closed_at` from the demo
  clock and adds a closing work note.
- `sys_id` is derived from the record's number, team, application and opened timestamp rather than
  randomly, so the same change produced twice keeps the same id and the store stays reproducible in
  tests.

**Storage** — exclusive writer on `servicenow_store` (`/storage/servicenow_store/snow.db`), shared with
[Sync ServiceNow Tickets](<../Sync ServiceNow Tickets/README.md>) and
[Chase Overdue Tickets](<../Chase Overdue Tickets/README.md>). Mounts `pipeline_state` read-only for
the demo clock offset.
