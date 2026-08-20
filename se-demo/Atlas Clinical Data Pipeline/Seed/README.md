Bootstraps plausible history so the console is populated on first launch.

**Triggered manually.** Not scheduled, not linked into the pipeline.

It clears the store and writes a known baseline: eight runs over the last week
including one hard failure (schema drift, with an AI triage note and an
approvable remediation attached), one degraded run with a low quality score, two
clean runs with open PHI quarantines, and several healthy runs — plus their
per-step log lines, rejections and published records.

Run it again at any point to reset the demo environment to that baseline. It
deletes real pipeline runs as well, so treat it as a reset button, not a top-up.

**Storage** — the `atlas` volume, read-write with exclusive writer scheduling.
