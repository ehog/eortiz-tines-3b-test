For each `allocated` plan, this step creates:
- one baseline NSG per subnet (`nsg-<rg>-<subnet>`) that explicitly denies inbound traffic from the Internet on the management ports;
- the VNet, with subnets carved from the allocation, each linked to its NSG and to `routeTableId` when it's set;
- spoke→hub and hub→spoke peerings when the template has `peerToHub` and `hubVnetId` is set.

PUTs are idempotent and long-running operations are polled. Each outcome is recorded under `provisioning/`. Output: `{ rgs: [...], failures: [...] }` for [Compliance checks](<../Compliance checks/README.md>).
