Turns Qualys detections into the canonical finding shape, attributes each one to an application and
owning team, and groups them for ticketing.

**Triggers** — linked from [Pull Qualys Findings](<../Pull Qualys Findings/README.md>) and
[Findings Webhook](<../Findings Webhook/README.md>); also the route `/qualys-remediation/run/normalize`,
which replays the last recorded pull payload when called with no body.

**Behaviour**

- Flattens the Qualys record into one finding: severity, CVSS, CVEs, KEV and exploit flags, asset,
  software inventory, the raw `RESULTS` evidence and the vendor solution text.
- Resolves ownership from [asset-owners.json](asset-owners.json) by hostname (case-insensitive):
  application, team, ServiceNow assignment group, owner email, criticality, exposure and environment. An
  asset that is not in the map takes the file's `fallback` entry, is flagged `owned: false`, and is
  routed to Security Operations for attribution rather than dropped.
- A detection's `ASSET.EXPOSURE_OVERRIDE` wins over the map's exposure, which is how the console
  demonstrates exposure changing a score.
- Groups findings by owning team and application, and within each group by asset.

**Output** — the pipeline envelope: `{run_id, trigger, stage, generated_at, findings[], groups[],
tickets[], notes[]}`. `generated_at` carries through from the pull so the whole run shares one reference
time.

**Storage** — `pipeline_state` exclusive, for the stage record.

**Tests** — a pinned test covers a mix of owned assets and one asset missing from the owner map,
asserting the fallback attribution and the resulting groups.
