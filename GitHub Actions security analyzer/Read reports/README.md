Part of GHAWA, a read-only GitHub Actions security analyzer. See the [workflow setup and runbook](../README.md).

Space-authenticated GET `/ghawa/reports`. No query lists recent reviews; `id` reads a durable report/status/receipts; `fixture` computes a read-only synthetic preview. Read-only state mount, no connectors or side effects. `api.json` documents callers. Preview calculations use synchronized rules/fixtures/report code. Does not trigger security analysis of arbitrary submitted content.
