**Trigger:** `/azure-rg/cleanup` (space members).

- `GET ?plan=<id>` shows the plan and an Approve/Reject form. Without `plan`, it lists recent plans.
- `POST` records the decision under the signed-in user's verified `x-3b-authenticated-email` and returns `202`. It passes the decision to [Execute cleanup](<../Execute cleanup/README.md>) in a base64 `X-RGLC-Decision` response header.
