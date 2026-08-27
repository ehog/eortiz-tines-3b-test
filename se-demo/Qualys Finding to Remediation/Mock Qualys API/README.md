Stands in for the Qualys VMDR Detection API so the pipeline can be demonstrated without Qualys
credentials.

**Trigger** — `GET`/`POST`/`PATCH`/`DELETE` on the space-private route
`/qualys-remediation/mock/qualys/findings`. See [api.json](api.json) for the full contract.

**Behaviour**

- `GET` returns detections in a simplified Qualys VMDR shape (`ID`, `QID`, `SEVERITY`, `CVSS`,
  `CVE_LIST`, `THREAT_INTEL`, `ASSET`, `SOFTWARE`, `RESULTS`, `SOLUTION`, first/last found, times
  detected), filterable by `since`, `updated_since`, `status` and `ids`.
- The first request against an empty store seeds [the canonical demo dataset](sample-findings.ts): a
  Windows Server 2022 cumulative update on an internet-facing DMZ host with a KEV CVE, a Log4Shell
  third-party library finding on a Linux app server, a code-level SQL injection with request/response
  and source evidence, two medium/low findings as noise, and one thin-evidence finding whose evidence
  deliberately cannot support a specific fix.
- `POST {action:"reset"}` reseeds that dataset. `POST {action:"inject", preset}` clones a preset as a
  fresh `Active` detection with a new id, which is how the console injects findings mid-demo.
- `PATCH` edits severity, CVSS, KEV, exploit status, title, status or the exposure override, or marks a
  detection `Fixed` with `{action:"remediate"}`. Any edit refreshes `last_updated`, which changes the
  detection's fingerprint so the next pull treats it as changed.
- `exposure_override` is not a Qualys field. It lets the console override the exposure the asset-owner
  lookup would otherwise supply, so a score can be moved without editing the owner map.

**Storage** — owns `qualys_state` (`/storage/qualys_state/qualys.db`) as an exclusive writer. Readers
mount it read-only.

`listDetections` in [qualys-db.ts](qualys-db.ts) is the seam to replace when swapping in real Qualys;
the same file is copied into [Pull Qualys Findings](<../Pull Qualys Findings/qualys-db.ts>).
