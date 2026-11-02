Automates the Azure resource group (RG) lifecycle: it provisions networking for new RGs, runs network compliance checks that Azure Policy doesn't cover, and does an approval-gated daily cleanup of unwanted resources.

**Current mode: simulation.** `simulate: true` in `config.json` sends every ARM and Entra ID call to a built-in simulator. The simulator keeps its state in the `rglc` volume and starts with a synthetic test subscription that has a hub VNet, a shadow-IT VNet, orphaned resources, an expired resource, an empty RG, and an IPAM record for an RG that was deleted.

#### Flows
1. **Provisioning** — [Event Grid webhook](<Event Grid webhook/README.md>) (or [Simulate RG creation](<Simulate RG creation/README.md>)) → [Allocate CIDR](<Allocate CIDR/README.md>) → [Provision network](<Provision network/README.md>) → [Compliance checks](<Compliance checks/README.md>) → [Notify Slack](<Notify Slack/README.md>) when something fails.
2. **Cleanup** — [Cleanup scan](<Cleanup scan/README.md>) runs daily at 02:00 UTC. It builds a dry-run plan and posts it with Approve/Reject links that open [Cleanup approval](<Cleanup approval/README.md>). An approval runs [Execute cleanup](<Execute cleanup/README.md>), which posts the results.
3. **[Dashboard](Dashboard/README.md)** (`/azure-rg`) — shows provisioning events, compliance history, IPAM allocations, cleanup plans, and the deletion audit log.

#### Configuration (`/storage/rglc/config.json`)
This file is created from the defaults in `config.ts` on the first run. Edit it in the storage browser to change: `simulate`, `subscriptions`, `ipamPools`, `hubVnetId`, `routeTableId`, `protectedResourceGroups`, `templates` (chosen by the `network-tier` tag, then the `env` tag, then `defaultTemplate`), `managementPorts`, `emptyRgMinAgeDays`, `maxCleanupItems`, and `slack.enabled` / `slack.channel`. If an RG has `network-tier=none` or `auto-network=false`, no network is provisioned for it.

#### State (`rglc` volume)
Each record is its own file, so concurrent runs never rewrite the same file:
- `ipam/active`, `ipam/by-rg`, `ipam/blocks`, `ipam/released`: IPAM records. Block lock files make two overlapping claims collide, so one of the runs fails before any Azure resources are created.
- `provisioning/`, `compliance/`: event records, pruned after 180 days.
- `plans/`, `decisions/`, `deletions/`: cleanup plans, approval decisions, and the per-item deletion audit trail (who approved, when, what, outcome).
- `rg-inventory/`: tracks how long each RG has been empty.
- `sim/`: simulator resources.

Every consequential action is also appended to the shared `audit` volume, following the space's logging standard.

#### Going live against real Azure
1. Attach a **Microsoft Azure** connector (service principal with Contributor on the target subscriptions, plus Network Contributor on the hub VNet) to Allocate CIDR, Provision network, Compliance checks, Cleanup scan, and Execute cleanup.
2. Attach a **Microsoft Graph** connector (User.Read.All) to Compliance checks.
3. Attach a **Slack** connector to Notify Slack and set `slack.enabled: true`.
4. In `config.json`, set `simulate: false`, the real test subscription ID, IPAM pools, hub VNet ID, route table ID, and protected RGs. Start with one subscription and add more once it's working.
5. Publish, then create an Event Grid subscription on each subscription. Use the WebHook endpoint `<live URL>/azure-rg/events?external_id=…`, event type `ResourceWriteSuccess`, and an advanced filter on `data.operationName = Microsoft.Resources/subscriptions/resourceGroups/write`.

ARM calls retry on 429 and 5xx responses with backoff (honoring `Retry-After`), and long-running operations are polled through `Azure-AsyncOperation` or `Location`.
