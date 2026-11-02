For each RG event, this step reads the RG's location and tags, picks a network template, and reserves address space in IPAM. The reservation is published **before** anything is created in Azure.

- If the VNet `vnet-<rg>` already exists, nothing new is allocated. An unrecorded VNet is adopted into IPAM, unless its range overlaps another allocation.
- If the RG already has an allocation, it is reused, so a retry never gets a second CIDR.
- Otherwise the first free block of the template's size is taken from `ipamPools`. Free means it doesn't overlap any IPAM record or any existing VNet in the target subscriptions.
- If two overlapping runs claim the same block, they collide on a lock file and one fails. `retry_seconds` re-runs it, and the retry sees the published claim.

Output: `{ planned: [{ status: allocated|existing|skipped|failed, cidr, template, vnetId, expectPeering, … }] }`.
