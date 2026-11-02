const BASE = process.env.SERVICE_NOW_URL;
const SIMULATED = !BASE;
const CLOSED_COMPLETE = "3";

function describe(result: any): string {
  const r = result.request;
  if (result.status !== "success") {
    return `DDI automation failed for ${r.requestType} (${r.fqdn ?? r.network}).\n` +
      `Error: ${result.error}\nPlease review manually.`;
  }
  const rec = result.record;
  const ip = rec.ipv4addr ?? rec.ipv4addrs?.[0]?.ipv4addr;
  const lines = [
    result.created ? "DDI request provisioned in Infoblox." : "Record already existed in Infoblox; no change made.",
    `Type: ${r.requestType}`,
    rec.name && `Name: ${rec.name}`,
    ip && `IP: ${ip}`,
    rec.canonical && `Canonical: ${rec.canonical}`,
    `Reference: ${rec._ref}`,
  ];
  return lines.filter(Boolean).join("\n");
}

async function updateRitm(sysId: string, body: Record<string, string>) {
  if (SIMULATED) return { sys_id: sysId, ...body, simulated: true };
  const res = await fetch(`${BASE}/api/now/table/sc_req_item/${sysId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ServiceNow ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text).result;
}

const result = JSON.parse(await Bun.stdin.text());
const ok = result.status === "success";
const body: Record<string, string> = { work_notes: describe(result) };
if (ok) body.state = CLOSED_COMPLETE;

const updated = await updateRitm(result.request.ritmSysId, body);
console.error(JSON.stringify({ event: "servicenow_updated", ok, simulated: SIMULATED }));
console.log(JSON.stringify({ ritm: result.request.ritmNumber, closed: ok, update: updated }));
if (!ok) process.exit(1);
