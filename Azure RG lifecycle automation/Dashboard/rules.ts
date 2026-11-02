import { API, type Arm } from "./arm";

export type CleanupKind =
  | "disk"
  | "public_ip"
  | "nic"
  | "nsg"
  | "expired_resource"
  | "expired_rg"
  | "empty_rg"
  | "ipam_release";

export interface CleanupItem {
  id: string;
  kind: CleanupKind;
  action: "delete" | "release_cidr";
  reason: string;
  subscriptionId: string;
  rgName: string;
  type: string;
  cidr?: string;
}

export const ORPHAN_COLLECTIONS = [
  { kind: "disk", type: "Microsoft.Compute/disks", api: API.compute },
  { kind: "public_ip", type: "Microsoft.Network/publicIPAddresses", api: API.network },
  { kind: "nic", type: "Microsoft.Network/networkInterfaces", api: API.network },
  { kind: "nsg", type: "Microsoft.Network/networkSecurityGroups", api: API.network },
] as const;

const KNOWN_VERSIONS: Record<string, string> = {
  "microsoft.resources/resourcegroups": API.resources,
  "microsoft.compute/disks": API.compute,
  "microsoft.network/publicipaddresses": API.network,
  "microsoft.network/networkinterfaces": API.network,
  "microsoft.network/networksecuritygroups": API.network,
  "microsoft.network/virtualnetworks": API.network,
  "microsoft.storage/storageaccounts": "2023-01-01",
};

export function orphanReason(kind: string, r: any): string | null {
  const p = r?.properties ?? {};
  switch (kind) {
    case "disk":
      return p.diskState === "Unattached" && !r.managedBy
        ? "Unattached managed disk"
        : null;
    case "public_ip":
      return !p.ipConfiguration && !p.natGateway ? "Unattached public IP" : null;
    case "nic":
      return !p.virtualMachine && !p.privateEndpoint && !p.privateLinkService
        ? "Orphaned NIC (no VM or private endpoint)"
        : null;
    case "nsg":
      return !p.subnets?.length && !p.networkInterfaces?.length
        ? "Orphaned NSG (no subnet or NIC)"
        : null;
    default:
      return null;
  }
}

export function expiredReason(
  tags: Record<string, string> | undefined,
  today: string,
): string | null {
  if (!tags) return null;
  const entry = Object.entries(tags).find(([k]) => k.toLowerCase() === "expires-on");
  if (!entry) return null;
  const date = new Date(entry[1]);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString().slice(0, 10);
  return iso < today ? `Tagged expires-on=${entry[1]} (past)` : null;
}

export function parseId(id: string) {
  const segs = id.split("/").filter(Boolean);
  return { subscriptionId: segs[1] ?? "", rgName: segs[3] ?? "" };
}

export async function apiVersionFor(arm: Arm, subscriptionId: string, type: string) {
  const known = KNOWN_VERSIONS[type.toLowerCase()];
  if (known) return known;
  const [ns, ...rest] = type.split("/");
  const provider = await arm.get(
    `/subscriptions/${subscriptionId}/providers/${ns}`,
    API.resources,
  );
  const rt = provider?.resourceTypes?.find(
    (t: any) => t.resourceType?.toLowerCase() === rest.join("/").toLowerCase(),
  );
  const stable = (rt?.apiVersions ?? []).filter((v: string) => !v.includes("preview"));
  if (stable.length) return stable.sort().reverse()[0];
  if (provider) throw new Error(`No stable API version for ${type}`);
  return "2023-01-01";
}
