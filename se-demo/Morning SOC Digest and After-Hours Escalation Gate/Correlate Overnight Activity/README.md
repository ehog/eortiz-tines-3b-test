Turns raw overnight records into correlated entities.

- **Trigger:** linked from [Collect Overnight Activity](<../Collect Overnight Activity/README.md>).
- **Behaviour:**
  1. normalises every source record, gate deferral, gate page and gate suppression into one alert shape;
  2. deduplicates on source + detection + user + host + indicator, keeping an occurrence count;
  3. correlates the remainder with union-find over shared user, host and indicator keys;
  4. splits out anything closed at the source (`Closed`, `Resolved`, `Auto-quarantined`, `Auto-mitigated`) or suppressed by the gate;
  5. ranks open entities by severity, CMDB tier, source diversity, gate score and volume.
- **Output:** `{ window, config, stats, bySource, entities, closedOrSuppressed }` to [Write Digest](<../Write Digest/README.md>).
- A pinned step test covers multi-source correlation, duplicate collapse and the closed/suppressed split.
