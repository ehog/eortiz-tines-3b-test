Part of GHAWA, a read-only GitHub Actions security analyzer. See the [workflow setup and runbook](../README.md).

Manual deterministic regression step; no routes, volumes, connectors or downstream links. Runs assertions over synthetic scenarios, YAML rules, baseline state, identity, path validation, HMAC byte behavior and runtime URL construction. Exits nonzero if any assertion fails. Prints a structured test summary on success. This is not a live API or browser integration test.
