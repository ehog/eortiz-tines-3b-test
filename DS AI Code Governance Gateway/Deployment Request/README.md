HTTP entry point of the governance gateway. Simulates Claude Code, GitHub Copilot, or a 3B-native build pushing an AI-generated automation toward production.

**Trigger:** `POST /ds-deploy` (route auth: external id — the unguessable id is in [config.toml](config.toml)).

Validates the payload, normalizes it, mints a `submission_id` when the caller omits one, and passes a plain JSON object to [Policy Scan](<../Policy Scan/script.ts>).

Required fields: `developer_name`, `team`, `region`, `source_tool`, `model_used`, `repo`, `code_payload`. Optional: `submission_id`, `developer_email`, `branch`, `commit_sha`, `description`, `pipeline`, `runner`.

Enum values are enforced: teams `R&D-Endodontics | Digital Dentistry | IT-Ops | Clinical Data`, regions `US | DE | JP`, tools `claude-code | github-copilot | 3b-native`, models `claude-sonnet-4-5 | gpt-4o | gemini-2.5-pro | azure-foundry-claude`.

No external services. Logs one line: `event=intake.accepted …`.
