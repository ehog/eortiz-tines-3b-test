const TYPES = ["next_ip", "host", "a", "cname"] as const;
type RequestType = (typeof TYPES)[number];

type DdiRequest = {
  ritmSysId: string;
  ritmNumber: string;
  requestType: RequestType;
  fqdn?: string;
  ipAddress?: string;
  network?: string;
  canonical?: string;
  dnsView: string;
  networkView: string;
  comment: string;
};

function parseHttpBody(raw: string): unknown {
  const sep = raw.indexOf("\r\n\r\n");
  const body = sep === -1 ? raw : raw.slice(sep + 4);
  return JSON.parse(body);
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

function normalize(payload: any): DdiRequest {
  const vars = payload.variables ?? {};
  const type = str(vars.request_type)?.toLowerCase() as RequestType;
  if (!TYPES.includes(type)) {
    throw new Error(`Unsupported request_type: ${vars.request_type}`);
  }
  const ritmSysId = str(payload.ritm_sys_id);
  if (!ritmSysId) throw new Error("Missing ritm_sys_id");

  return {
    ritmSysId,
    ritmNumber: str(payload.ritm_number) ?? ritmSysId,
    requestType: type,
    fqdn: str(vars.fqdn)?.toLowerCase(),
    ipAddress: str(vars.ip_address),
    network: str(vars.network),
    canonical: str(vars.canonical_name)?.toLowerCase(),
    dnsView: str(vars.dns_view) ?? "default",
    networkView: str(vars.network_view) ?? "default",
    comment: `${str(payload.ritm_number) ?? ritmSysId}: ${
      str(vars.business_justification) ?? "DDI request"
    }`.slice(0, 256),
  };
}

function validate(r: DdiRequest): void {
  const need = (ok: unknown, msg: string) => {
    if (!ok) throw new Error(`${r.ritmNumber}: ${msg}`);
  };
  if (r.requestType === "next_ip") need(r.network, "network is required");
  if (r.requestType === "host") {
    need(r.fqdn, "fqdn is required");
    need(r.ipAddress || r.network, "ip_address or network is required");
  }
  if (r.requestType === "a") {
    need(r.fqdn, "fqdn is required");
    need(r.ipAddress, "ip_address is required");
  }
  if (r.requestType === "cname") {
    need(r.fqdn, "fqdn is required");
    need(r.canonical, "canonical_name is required");
  }
}

const request = normalize(parseHttpBody(await Bun.stdin.text()));
validate(request);
console.error(JSON.stringify({ event: "request_received", ...request }));
console.log(JSON.stringify(request));
