const TYPES = ["next_ip", "host", "a", "cname"];

function parseRequest(raw: string) {
  const sep = raw.indexOf("\r\n\r\n");
  const head = raw.slice(0, sep);
  const email = head.match(/^x-3b-authenticated-email:\s*(.+)$/im)?.[1].trim();
  return { email: email ?? "unknown", body: JSON.parse(raw.slice(sep + 4) || "{}") };
}

function str(v: unknown): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}

function normalize(f: any, email: string) {
  const ritmNumber = `RITM${String(Date.now()).slice(-7)}`;
  const type = str(f.request_type);
  const r = {
    ritmSysId: crypto.randomUUID().replaceAll("-", ""),
    ritmNumber,
    requestType: type,
    fqdn: str(f.fqdn)?.toLowerCase(),
    ipAddress: str(f.ip_address),
    network: str(f.network),
    canonical: str(f.canonical_name)?.toLowerCase(),
    dnsView: str(f.dns_view) ?? "default",
    networkView: str(f.network_view) ?? "default",
    comment: `${ritmNumber} (${email}): ${str(f.business_justification) ?? "DDI request"}`
      .slice(0, 256),
  };
  return { r, errors: validate(r) };
}

function validate(r: any): string[] {
  const e: string[] = [];
  if (!TYPES.includes(r.requestType)) e.push("Choose a request type");
  const needFqdn = ["host", "a", "cname"].includes(r.requestType);
  if (needFqdn && !r.fqdn) e.push("FQDN is required");
  if (r.requestType === "next_ip" && !r.network) e.push("Network is required");
  if (r.requestType === "host" && !r.ipAddress && !r.network) {
    e.push("IP address or network is required");
  }
  if (r.requestType === "a" && !r.ipAddress) e.push("IP address is required");
  if (r.requestType === "cname" && !r.canonical) e.push("Canonical name is required");
  return e;
}

function respond(status: string, body: unknown) {
  const json = JSON.stringify(body);
  process.stdout.write(
    `HTTP/1.1 ${status}\r\nContent-Type: application/json\r\n\r\n${json}`,
  );
}

const { email, body } = parseRequest(await Bun.stdin.text());
const { r, errors } = normalize(body, email);
if (errors.length) {
  console.error(JSON.stringify({ event: "form_rejected", email, errors }));
  respond("400 Bad Request", { errors });
  process.exit(0);
}
console.error(JSON.stringify({ event: "form_submitted", email, ...r }));
respond("202 Accepted", r);
