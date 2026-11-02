**Trigger:** `POST /azure-rg/simulate` (space members). Works only when `simulate: true`.

Body: `{ "name": "rg-x", "location": "eastus", "tags": { "env": "prod", "owner": "alice@contoso.com" } }`. Creates the RG in the simulator and emits the same response shape as the [Event Grid webhook](<../Event Grid webhook/README.md>), so the full provisioning flow runs.

Simulated Entra ID users are listed in `simulatedDirectoryUsers`. Any other owner fails the owner check.
