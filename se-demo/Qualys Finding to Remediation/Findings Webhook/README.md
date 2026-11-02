Push path for Qualys detections, as an alternative to the 15-minute pull.

**Trigger** — `POST /qualys-remediation/webhook/qualys` with `route_auth = "external_id"`. 3B mints the
unguessable ID; callers pass it as the `external_id` query parameter, and it appears on the workflow's
Links page once published. On a draft branch the route is still restricted to members of this space.

**Behaviour**

- Accepts a single detection, an array of them, or `{data: [...]}`. Requires `ID`, `QID`, `TITLE`,
  `SEVERITY` and `ASSET.HOSTNAME`; every other field is defaulted, so a partial push is still usable.
- Records the fingerprint of each pushed detection, so a later scheduled pull does not re-emit it.
- Emits the same pull envelope shape as [Pull Qualys Findings](<../Pull Qualys Findings/README.md>) with
  `trigger: "webhook"`, and links into [Normalize And Group](<../Normalize And Group/README.md>).
- A malformed payload is recorded as a failed `pull` stage run and the step exits non-zero. There is no
  output step on this path, so a successful push receives `202 Accepted`.

**Storage** — `pipeline_state` exclusive, for the fingerprints and the stage record.
