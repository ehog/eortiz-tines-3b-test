**Trigger:** daily at 02:00 UTC. Schedules run only once the workflow is published.

Across the target subscriptions, it flags:
- unattached disks and public IPs;
- NICs with no VM or private endpoint;
- NSGs with no subnet or NIC;
- resources and RGs tagged `expires-on` with a past date;
- RGs that have been empty for at least `emptyRgMinAgeDays` (tracked in `rg-inventory/`);
- IPAM allocations whose RG no longer exists.

Anything tagged `do-not-delete=true`, or in a protected RG, is excluded. The result is saved as a dry-run plan in `plans/`, and the step outputs a Slack summary with Approve/Reject links. A newer plan supersedes older pending ones, and plans expire after 48 hours. The step also prunes provisioning and compliance records older than 180 days.
