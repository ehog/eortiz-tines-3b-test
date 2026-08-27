Records a patch decision made in the console and fans out to the same actions as the Slack buttons.

**Trigger** — HTTP `POST /api/decide`, `route_auth = "space"`. Body: `{decision: "YES"|"NO", device_id, device_name, package_id, package_name, severity?}`. `decided_by` is taken from the spoof-proof `x-3b-authenticated-email` header, never from the body.

**Behavior** — validates the body, writes a `decisions` row with `source = "app"`, sets the finding's `status` to `patching` (YES) or `postponed` (NO), and responds with the stored record. Invalid bodies get `400` and a wrong method gets `405`; those responses carry no trailing payload, so no downstream action fires.

**Output contract** — the HTTP response is followed by a single JSON line, identical in shape to the one [Handle patch decision](<../Handle patch decision/README.md>) emits, so [Install patch](<../Install patch/README.md>) and [Postpone and create case](<../Postpone and create case/README.md>) work unchanged from either entry point.

**Volume** — `patching:concurrency=exclusive`, since it updates the same rows the discovery scan and the Slack route touch.

**Side effects** — a `YES` really queues an Automox `InstallUpdate` downstream; a `NO` really opens a Tines case and posts to Slack.
