Start of the morning digest chain.

- **Trigger:** cron `0 10,11 * * 1-5` (UTC). It exits with no output unless the current time is 06:00 in America/New_York, so exactly one tick per weekday runs across DST changes. A linked run carrying `{ "trigger": "manual" }` (from [Run Digest Now](<../Run Digest Now/README.md>)) bypasses that check.
- **Behaviour:** reads `config`, `critical_assets`, the pending `deferred_queue` and the window's `gate_decisions` from the volume, then collects `config.digest.lookbackHours` (default 14) of mocked activity from the five source modules in [sources](./sources).
- **Output:** `{ trigger, window, config, assets, sources, deferred, gateDecisions }` to [Correlate Overnight Activity](<../Correlate Overnight Activity/README.md>).
- Each module in [sources](./sources) mocks one vendor and notes the real endpoint to call once that vendor's connector is attached. Mock data is generated from a seed derived from the collection window, so a run is stable within the hour.
- **Volume:** `soc_state`, read-only.
