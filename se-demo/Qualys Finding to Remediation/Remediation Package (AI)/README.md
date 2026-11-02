Produces the remediation package an owning team will actually execute: the specific fix, the exact
commands, a code diff where the finding is code-level, the disruption it causes, and the Qualys evidence
that justifies it.

**Triggers** — linked from [Prioritize](../Prioritize/README.md); also the route
`/qualys-remediation/run/remediate`, which replays the last recorded prioritize payload when called with
no body.

**Shape** — one structured model call per finding, not an agent loop. Every input is known up front (the
finding, its software inventory and the Qualys evidence blob) and no tool needs to be called, so there is
nothing for a loop to discover. Calls run three at a time, capped at eight packages per run; anything
beyond the cap is queued for the next run rather than dropped silently.

**Behaviour**

- Only findings at or above the high-priority threshold get a model call. Below-threshold findings get a
  deterministic summary built from the Qualys solution text and marked `source: "deterministic"`, so
  every finding on a change still carries something an engineer can read.
- The model must answer through the `submit_remediation_package` tool, so output is always structured:
  `required_fix`, `fix_version`, `commands[]` (platform, description, command), `code_fix` (file,
  language, before, after, note), `prerequisites[]`, `reboot_required`, `service_impact`,
  `validation[]`, `evidence_citations[]`, `missing_evidence[]` and `confidence`.
- [system.md](system.md) requires every fact to be grounded in the supplied evidence, requires verbatim
  citations, and requires `determinable: false` with the specific gaps listed when the evidence cannot
  identify the affected component and version. The thin-evidence sample finding exercises that path.
- A single failed call degrades to a package that says the generation failed. If every call in a run
  fails, the step exits non-zero rather than reporting success with empty packages.

**Model** — `claude-sonnet-5` through the Anthropic connector, streamed, with the system prompt cached.
Sonnet is chosen for demo latency; change `MODEL` at the top of [script.ts](script.ts) to
`claude-opus-5` for the strongest output. The connector's base URL already ends in `/v1`, which the SDK
appends itself, so the step trims it.

**Storage** — `pipeline_state` exclusive, for the stage record.

This step is not step-tested: its output is model-generated and intentionally not byte-stable.
