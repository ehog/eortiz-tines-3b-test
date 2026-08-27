`POST /api/runs/retry` (space-only). Resumes a failed run at its first incomplete stage and links to [Containment Orchestrator](<../Containment Orchestrator/README.md>) with `mode: "resume"`.

Body: `runId`, plus either `clearChaos: true` (resume with all forced failures off) or a replacement `chaos` object. Supplying either also clears that run's chaos attempt counters, so a "fail N then succeed" toggle starts over.

Responds `202` with `resumeFrom`, `skipping` (stages that already succeeded and will not be repeated) and `resumeCount`; `404` for an unknown run and `409` when the run is already contained or has nothing incomplete. Those non-2xx bodies carry no `runId`, so the orchestrator ignores them.
