import { dir, logger, readInput, readJson, sanitizeId, writeJson, type Entities, type Incident } from "./lib";

const input = (await readInput()).json as Record<string, unknown> | null;
if (!input) throw new Error("no incident on stdin");

const investigationId = sanitizeId(input.investigationId);
const audit = logger(investigationId, "Extract entities");
const incident = await readJson<Incident>(`${dir(investigationId)}/incident.json`);
if (!incident) throw new Error(`no incident.json for ${investigationId}`);

const haystack = JSON.stringify(incident.raw);
const entities: Entities = {
  investigationId,
  users: [],
  devices: [],
  internalIps: [],
  externalIps: [],
  urls: [],
  domains: [],
  hashes: [],
  processes: [],
};

for (const entity of incident.vendorEntities) {
  const kind = `${entity["@odata.type"] ?? entity.kind ?? entity.type ?? ""}`.toLowerCase();
  const props = (entity.properties ?? entity) as Record<string, unknown>;
  if (kind.includes("device") || kind.includes("host")) {
    const hostName = text(props.deviceDnsName ?? props.hostName ?? props.HostName ?? props.deviceName);
    const dnsDomain = text(props.dnsDomain ?? props.DnsDomain);
    push(entities.devices, hostName.includes(".") || !dnsDomain ? hostName : `${hostName}.${dnsDomain}`);
    for (const user of arr(props.loggedOnUsers)) {
      const u = user as Record<string, unknown>;
      push(entities.users, upn(text(u.accountName ?? u.userName), text(u.domainName ?? u.domain)));
    }
    for (const nic of arr(props.ipInterfaces)) {
      const addresses = arr((nic as Record<string, unknown>).ipAddresses);
      for (const address of addresses) classifyIp(text(address));
    }
  } else if (kind.includes("account") || kind.includes("user") || kind.includes("mailbox")) {
    push(
      entities.users,
      text(props.userPrincipalName ?? props.upn ?? props.Name) ||
        upn(text(props.accountName ?? props.name), text(props.domainName ?? props.UPNSuffix)),
    );
  } else if (kind.includes("ip")) {
    classifyIp(text(props.ipAddress ?? props.Address ?? props.address));
  } else if (kind.includes("url")) {
    pushUrl(text(props.url ?? props.Url));
  } else if (kind.includes("dnsresolution") || kind.includes("domain")) {
    push(entities.domains, text(props.domainName ?? props.DomainName));
  } else if (kind.includes("file") || kind.includes("hash")) {
    const details = (props.fileDetails ?? props) as Record<string, unknown>;
    push(entities.hashes, text(details.sha256 ?? details.SHA256 ?? details.fileHash ?? details.Value));
    pushProcess(text(details.fileName ?? details.Name));
  } else if (kind.includes("process")) {
    const image = (props.imageFile ?? {}) as Record<string, unknown>;
    pushProcess(text(image.fileName ?? image.name));
    pushProcess(text(props.processName ?? props.ProcessName ?? props.name));
  } else if (kind.includes("mail")) {
    push(entities.users, text(props.recipientEmailAddress ?? props.p1Sender ?? props.senderIp));
  }
}

// The two vendor shapes label entities inconsistently, so a regex sweep of the raw payload
// catches anything the typed mapping above missed.
for (const match of haystack.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) classifyIp(match[0]);
for (const match of haystack.matchAll(/https?:\/\/[^\s"'<>\\]{4,200}/g)) pushUrl(match[0]);
for (const match of haystack.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) push(entities.users, match[0]);
for (const match of haystack.matchAll(/\b[a-fA-F0-9]{64}\b|\b[a-fA-F0-9]{40}\b|\b[a-fA-F0-9]{32}\b/g))
  push(entities.hashes, match[0].toLowerCase());
for (const match of haystack.matchAll(/\b[A-Za-z0-9_.-]{2,60}\.(?:exe|dll|ps1|bat|scr|js|vbs|hta|cmd)\b/gi))
  push(entities.processes, match[0].toLowerCase());

for (const user of entities.users) {
  const domain = user.split("@")[1];
  if (domain && !isInternalDomain(domain)) push(entities.domains, domain.toLowerCase());
}
entities.users = entities.users.map((u) => u.toLowerCase()).filter(unique);
entities.devices = entities.devices.map((d) => d.toLowerCase()).filter(unique);

audit.log(
  "entities_extracted",
  investigationId,
  "ok",
);
audit.log(
  "entity_counts",
  Object.entries(entities)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k}=${(v as string[]).length}`)
    .join(","),
  "ok",
);

await writeJson(`${dir(investigationId)}/entities.json`, entities);
console.log(JSON.stringify(entities));

function push(target: string[], value: string): void {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return;
  if (!target.includes(trimmed)) target.push(trimmed);
}

/** Only executable artefacts belong in the process list; documents stay evidence via their hash. */
function pushProcess(value: string): void {
  if (/\.(?:exe|dll|ps1|bat|scr|js|vbs|hta|cmd|com|msi)$/i.test(value.trim())) push(entities.processes, value.trim().toLowerCase());
}

function pushUrl(value: string): void {  const cleaned = value.replace(/[).,;'"]+$/, "");
  push(entities.urls, cleaned);
  try {
    push(entities.domains, new URL(cleaned).hostname.toLowerCase());
  } catch {
    // a malformed URL contributes no domain
  }
}

function classifyIp(value: string): void {
  const ip = value.trim();
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip)) return;
  const octets = ip.split(".").map(Number);
  if (octets.some((o) => o > 255)) return;
  const [a, b] = octets;
  const internal =
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254);
  push(internal ? entities.internalIps : entities.externalIps, ip);
}

function upn(account: string, domain: string): string {
  if (!account) return "";
  if (account.includes("@")) return account;
  return domain ? `${account}@${domain}` : account;
}

function isInternalDomain(domain: string): boolean {
  return /(?:^|\.)(contoso\.com|corp\.local|internal)$/i.test(domain);
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function unique(value: string, index: number, all: string[]): boolean {
  return all.indexOf(value) === index;
}
