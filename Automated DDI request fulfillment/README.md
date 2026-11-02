Fulfils approved DDI requests from ServiceNow: it creates records in Infoblox NIOS, then adds a work note to the ServiceNow request item (RITM) and closes it.

**Flow**
1. [Receive approved request](<Receive approved request/script.ts>): a webhook (`/ddi/servicenow-approved`, `external_id` auth) that ServiceNow calls when a RITM is approved. It checks the form variables and normalizes them.
2. [Provision in Infoblox](<Provision in Infoblox/script.ts>): calls NIOS WAPI `v2.12`. Handles `next_ip` (fixed-address reservation with match type RESERVED), `host`, `a` and `cname`. For DNS records, it looks up the name first and won't create a duplicate.
3. [Update ServiceNow](<Update ServiceNow/script.ts>): adds a work note to the `sc_req_item` and sets it to Closed Complete. On failure it adds the error as a work note, leaves the RITM open, and the run is marked failed.

**Self-service form**
[DDI request form](<DDI request form/App.tsx>) (`/ddi/request`, space members) lets users submit requests directly. [Submit DDI request](<Submit DDI request/script.ts>) validates each submission, assigns a synthetic RITM number and feeds it into the same provisioning flow. Rejected submissions (400) stop there.

**Expected ServiceNow payload**
```json
{
  "ritm_sys_id": "…", "ritm_number": "RITM0012345",
  "variables": {
    "request_type": "next_ip | host | a | cname",
    "fqdn": "app01.corp.orbia.com", "ip_address": "10.20.30.15",
    "network": "10.20.30.0/24", "canonical_name": "target.corp.orbia.com",
    "dns_view": "default", "network_view": "default",
    "business_justification": "…"
  }
}
```

**Simulation mode**
If `INFOBLOX_URL` or `SERVICE_NOW_URL` isn't set (no connector attached), that step returns realistic synthetic responses instead of calling the real system. Each step's output includes `"simulated": true`.

**Going live**
- Attach an Infoblox NIOS connector to *Provision in Infoblox*. NIOS is internal, so it also needs a 3B tunnel network that gives this space access.
- Attach a ServiceNow connector to *Update ServiceNow*.
- In ServiceNow, add a Flow Designer REST step that runs on RITM approval and POSTs the payload above to the published webhook URL.
