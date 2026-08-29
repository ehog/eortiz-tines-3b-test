Single endpoint behind the demo console.

- **Trigger:** `/api/console`, space auth, `route_type = "api"` with [api.json](./api.json).
- **GET** returns the whole console state in one payload — config and shipped defaults, demo clock mode, CMDB assets, scenario catalogue, counters, decision audit with breakdowns, page inbox, deferred queue, recent digests, timeline and the branch-aware route paths the app posts to. No server timestamps are included, so the response is stable for polling and for step tests.
- **POST** applies one `action` and returns the refreshed state: `save_config`, `set_clock`, `upsert_asset`, `delete_asset`, `ack_page`, `resolve_page`, `clear_pages`, `replay_last`, `reset_demo`.
  - `replay_last` re-scores an alert (newest by default) with the saved config, writes an audit row marked as a replay, and pages if the new score crosses the threshold — this is what proves the threshold is live.
  - `reset_demo` restores default config and CMDB, clears history and, unless `preloadBacklog` is `false`, seeds 12 overnight alerts scored under after-hours rules. Seeded pages are written straight to the inbox without re-posting to Slack.
- Config writes go through `mergeConfig`, which clamps and backfills every field, so a partial or malformed payload cannot corrupt the gate.
- **Connector:** Slack (for pages raised by `replay_last`). **Volume:** `soc_state`, exclusive writer.
- `set_notifications` patches `notifications` (`digestEmail`, `digestSlack`, `pageSlack`) without touching the rest of the config, and logs the change to the timeline.
