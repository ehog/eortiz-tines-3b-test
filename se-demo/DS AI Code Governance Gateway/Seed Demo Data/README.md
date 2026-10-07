Resets the demo to a known state. Run this before a demo.

**Trigger:** `POST /ds-seed` (route auth: space members), or run the step manually.

Clears the `ds_governance` volume and rebuilds it deterministically (fixed PRNG seed) with 42 historical submissions and 5 pending reviews, scored through the same [scan](scan.ts), [model policy](model-policy.ts), and [bypass](bypass.ts) logic the live path uses — so the seeded history is consistent with anything triggered on the call. Timestamps are spread across the last 14 days relative to run time, so the trend chart and "today" KPIs are always populated.

Deliberately planted: two blocked bypass attempts (a personal repo on a self-hosted MacBook, and a lab repo on an unsanctioned runner) and a pending Clinical Data / US submission using `gpt-4o` that trips HIPAA rule `MP-001` with PHI findings at risk score 100.

Logs `event=seed.completed …`. Rerunning it discards any live submissions created during the demo.
