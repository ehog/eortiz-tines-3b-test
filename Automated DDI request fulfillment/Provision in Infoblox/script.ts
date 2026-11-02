const WAPI_VERSION = "v2.12";
const BASE = process.env.INFOBLOX_URL;
const SIMULATED = !BASE;

type DdiRequest = {
  ritmSysId: string;
  ritmNumber: string;
  requestType: "next_ip" | "host" | "a" | "cname";
  fqdn?: string;
  ipAddress?: string;
  network?: string;
  canonical?: string;
  dnsView: string;
  networkView: string;
  comment: string;
};

type WapiCall = { objType: string; lookup?: Record<string, string>; body: any };

function buildCall(r: DdiRequest): WapiCall {
  const nextIp = `func:nextavailableip:${r.network},${r.networkView}`;
  switch (r.requestType) {
    case "next_ip":
      return {
        objType: "fixedaddress",
        body: {
          ipv4addr: nextIp,
          match_client: "RESERVED",
          network_view: r.networkView,
          comment: r.comment,
        },
      };
    case "host":
      return {
        objType: "record:host",
        lookup: { name: r.fqdn!, view: r.dnsView },
        body: {
          name: r.fqdn,
          view: r.dnsView,
          ipv4addrs: [{ ipv4addr: r.ipAddress ?? nextIp }],
          comment: r.comment,
        },
      };
    case "a":
      return {
        objType: "record:a",
        lookup: { name: r.fqdn!, view: r.dnsView },
        body: { name: r.fqdn, view: r.dnsView, ipv4addr: r.ipAddress, comment: r.comment },
      };
    case "cname":
      return {
        objType: "record:cname",
        lookup: { name: r.fqdn!, view: r.dnsView },
        body: { name: r.fqdn, view: r.dnsView, canonical: r.canonical, comment: r.comment },
      };
  }
}

function simulate(call: WapiCall): any {
  const octet = 10 + Math.floor(Math.random() * 200);
  const prefix = (call.body.ipv4addr ?? "").startsWith("func:")
    ? call.body.ipv4addr.split(":")[2].split("/")[0].split(".").slice(0, 3).join(".")
    : null;
  const ip = prefix ? `${prefix}.${octet}` : call.body.ipv4addr;
  const result = { ...call.body, _ref: `${call.objType}/ZG5zLmZha2U:simulated` };
  if (call.objType === "record:host") {
    const addr = call.body.ipv4addrs[0].ipv4addr;
    result.ipv4addrs = [{ ipv4addr: addr.startsWith("func:") ? `${addr.split(":")[2].split("/")[0].split(".").slice(0, 3).join(".")}.${octet}` : addr }];
  } else if (ip) {
    result.ipv4addr = ip;
  }
  return result;
}

async function wapi(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}/wapi/${WAPI_VERSION}/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WAPI ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function execute(call: WapiCall): Promise<{ created: boolean; record: any }> {
  if (SIMULATED) return { created: true, record: simulate(call) };
  if (call.lookup) {
    const q = new URLSearchParams({ ...call.lookup, _return_fields: "+comment" });
    const existing = await wapi(`${call.objType}?${q}`);
    if (existing.length > 0) return { created: false, record: existing[0] };
  }
  const q = "_return_as_object=1&_return_fields%2B=comment";
  const res = await wapi(`${call.objType}?${q}`, {
    method: "POST",
    body: JSON.stringify(call.body),
  });
  return { created: true, record: res.result };
}

// The form's submit step passes its HTTP response; only accepted requests proceed.
function readRequest(raw: string): DdiRequest | null {
  if (!raw.startsWith("HTTP/")) return JSON.parse(raw);
  if (!/^HTTP\/[\d.]+ 202/.test(raw)) return null;
  return JSON.parse(raw.slice(raw.indexOf("\r\n\r\n") + 4));
}

const request = readRequest(await Bun.stdin.text());
if (!request) process.exit(0);
const call = buildCall(request);
let output;
try {
  const { created, record } = await execute(call);
  output = { status: "success", simulated: SIMULATED, created, request, record };
} catch (err) {
  output = { status: "failed", simulated: SIMULATED, request, error: String(err) };
}
console.error(JSON.stringify({ event: "infoblox_result", ...output }));
console.log(JSON.stringify(output));
