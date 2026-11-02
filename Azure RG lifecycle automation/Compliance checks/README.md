Runs only the checks that Azure Policy doesn't cover:
- `ipam_cidr_match`: the VNet address space equals the IPAM record.
- `no_vnet_overlap`: no other VNet in the target subscriptions overlaps it.
- `hub_peering_connected`: the hub peering reaches `Connected`; the step polls for up to 60 seconds.
- `nsg_mgmt_ports_closed`: no inbound Allow rule from `*`, `0.0.0.0/0`, Internet, or Any covers 22 or 3389.
- `subnet_nsg_route_table`: every subnet has an NSG and the expected route table.
- `owner_in_entra_id`: the `owner` tag resolves to an enabled Entra ID user through Microsoft Graph `/users`.

Each RG's results are written to `compliance/`. If any check or any provisioning attempt failed, the step outputs a Slack message with remediation hints.
