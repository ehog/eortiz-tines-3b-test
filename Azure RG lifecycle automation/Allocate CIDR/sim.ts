import type { Arm, DeleteResult, Directory } from "./arm";
import type { Config } from "./config";
import { log } from "./log";
import { claimAllocation, keyOf, listNames, readJson, removeFile, writeJson } from "./store";

const SIM_DIR = "sim";

const RG_TYPE = "Microsoft.Resources/resourceGroups";
const VNET_TYPE = "Microsoft.Network/virtualNetworks";
const PEERING_TYPE = "Microsoft.Network/virtualNetworks/virtualNetworkPeerings";
const NSG_TYPE = "Microsoft.Network/networkSecurityGroups";
const NIC_TYPE = "Microsoft.Network/networkInterfaces";

class SimNotFound extends Error {
  status = 404;
  code = "ResourceGroupNotFound";
}

function clean(path: string) {
  return path.split("?")[0].replace(/\/+$/, "");
}

function segments(path: string) {
  return clean(path).split("/").filter(Boolean);
}

function typeOf(path: string): string | null {
  const segs = segments(path);
  if (segs.length === 4 && segs[2].toLowerCase() === "resourcegroups") {
    return RG_TYPE;
  }
  const p = segs.findIndex((s) => s.toLowerCase() === "providers");
  if (p < 0) return null;
  const rest = segs.slice(p + 2);
  const types = rest.filter((_, i) => i % 2 === 0);
  return `${segs[p + 1]}/${types.join("/")}`;
}

function rgPrefix(path: string) {
  return "/" + segments(path).slice(0, 4).join("/");
}

function isTopLevel(id: string) {
  const segs = segments(id);
  const p = segs.findIndex((s) => s.toLowerCase() === "providers");
  return p === 4 && segs.length === 8;
}

const eq = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export class SimArm implements Arm {
  private cache: Map<string, any> | null = null;

  constructor(
    private cfg: Config,
    private granule: number,
    private writable: boolean,
  ) {
    if (writable) this.seedIfEmpty();
  }

  private store(): Map<string, any> {
    if (!this.cache) {
      this.cache = new Map();
      for (const name of listNames(SIM_DIR)) {
        const r = readJson(`${SIM_DIR}/${name}`);
        this.cache.set(r.id.toLowerCase(), r);
      }
    }
    return this.cache;
  }

  private all(): any[] {
    return [...this.store().values()];
  }

  private raw(path: string): any | null {
    return this.store().get(clean(path).toLowerCase()) ?? null;
  }

  private save(resource: any) {
    if (!this.writable) throw new Error("Simulator is read-only in this step.");
    this.store().set(resource.id.toLowerCase(), resource);
    writeJson(`${SIM_DIR}/${keyOf(resource.id)}.json`, resource);
  }

  private drop(id: string) {
    if (!this.writable) throw new Error("Simulator is read-only in this step.");
    this.store().delete(id.toLowerCase());
    removeFile(`${SIM_DIR}/${keyOf(id)}.json`);
  }

  async get(path: string, _v: string) {
    const r = this.raw(path);
    return r ? this.decorate(r) : null;
  }

  async list(path: string, _v: string) {
    const segs = segments(path);
    const items = this.all();
    const last = segs[segs.length - 1].toLowerCase();
    const sub = `/subscriptions/${segs[1]}`.toLowerCase();
    if (segs.length === 3 && last === "resourcegroups") {
      return items.filter(
        (r) => r.type === RG_TYPE && r.id.toLowerCase().startsWith(sub + "/"),
      );
    }
    if (last === "resources") {
      const scope = "/" + segs.slice(0, -1).join("/").toLowerCase() + "/";
      return items
        .filter((r) => r.type !== RG_TYPE && isTopLevel(r.id))
        .filter((r) => r.id.toLowerCase().startsWith(scope))
        .map((r) => this.decorate(r));
    }
    const type = typeOf(path)!;
    const parentIsNamespace = segs[segs.length - 3]?.toLowerCase() === "providers";
    const scopeSegs = parentIsNamespace ? segs.slice(0, -3) : segs.slice(0, -1);
    const scope = "/" + scopeSegs.join("/").toLowerCase() + "/";
    return items
      .filter((r) => eq(r.type, type) && r.id.toLowerCase().startsWith(scope))
      .map((r) => this.decorate(r));
  }

  async put(path: string, _v: string, body: any) {
    log("debug", "sim_arm_call", "Simulated ARM PUT.", { path: clean(path) });
    const id = clean(path);
    const type = typeOf(id);
    if (!type) throw new Error(`Unsupported simulated path: ${id}`);
    if (type !== RG_TYPE && !this.raw(rgPrefix(id))) {
      throw new SimNotFound(`Resource group for ${id} not found.`);
    }
    const segs = segments(id);
    const props = { ...(body.properties ?? {}), provisioningState: "Succeeded" };
    if (type === VNET_TYPE) {
      props.subnets = (props.subnets ?? []).map((s: any) => ({
        ...s,
        id: `${id}/subnets/${s.name}`,
        properties: { ...s.properties, provisioningState: "Succeeded" },
      }));
      delete props.virtualNetworkPeerings;
    }
    const existing = this.raw(id);
    this.save({
      ...(existing ?? {}),
      ...body,
      id,
      name: segs[segs.length - 1],
      type,
      properties: props,
    });
    return this.get(id, _v);
  }

  async delete(path: string, _v: string): Promise<DeleteResult> {
    log("debug", "sim_arm_call", "Simulated ARM DELETE.", { path: clean(path) });
    const key = clean(path).toLowerCase();
    if (!this.raw(key)) return "not_found";
    for (const r of this.all()) {
      const id = r.id.toLowerCase();
      if (id === key || id.startsWith(key + "/")) this.drop(r.id);
    }
    return "deleted";
  }

  private decorate(r: any): any {
    if (r.type === VNET_TYPE) {
      const peerings = this.all()
        .filter((p) => p.type === PEERING_TYPE)
        .filter((p) => p.id.toLowerCase().startsWith(r.id.toLowerCase() + "/"))
        .map((p) => this.peeringWithState(p, r.id));
      return { ...r, properties: { ...r.properties, virtualNetworkPeerings: peerings } };
    }
    if (r.type === NSG_TYPE) {
      const all = this.all();
      const subnets = all
        .filter((v) => v.type === VNET_TYPE)
        .flatMap((v) => v.properties.subnets ?? [])
        .filter((s: any) => eq(s.properties?.networkSecurityGroup?.id, r.id))
        .map((s: any) => ({ id: s.id }));
      const nics = all
        .filter((n) => n.type === NIC_TYPE)
        .filter((n) => eq(n.properties?.networkSecurityGroup?.id, r.id))
        .map((n) => ({ id: n.id }));
      return {
        ...r,
        properties: { ...r.properties, subnets, networkInterfaces: nics },
      };
    }
    return r;
  }

  private peeringWithState(peering: any, localVnetId: string) {
    const remoteId = peering.properties?.remoteVirtualNetwork?.id;
    const remoteBack = this.all().some(
      (p) =>
        p.type === PEERING_TYPE &&
        p.id.toLowerCase().startsWith(String(remoteId).toLowerCase() + "/") &&
        eq(p.properties?.remoteVirtualNetwork?.id, localVnetId),
    );
    const state = remoteBack ? "Connected" : "Initiated";
    return { ...peering, properties: { ...peering.properties, peeringState: state } };
  }

  private seedIfEmpty() {
    if (listNames(SIM_DIR).length > 0) return;
    const sub = `/subscriptions/${this.cfg.subscriptions[0]}`;
    const rg = (name: string, tags: Record<string, string> = {}) => ({
      id: `${sub}/resourceGroups/${name}`,
      name,
      type: RG_TYPE,
      location: "eastus",
      tags,
      properties: { provisioningState: "Succeeded" },
    });
    const res = (
      rgName: string,
      type: string,
      name: string,
      properties: any,
      tags: Record<string, string> = {},
      extra: any = {},
    ) => ({
      id: `${sub}/resourceGroups/${rgName}/providers/${type}/${name}`,
      name,
      type,
      location: "eastus",
      tags,
      properties,
      ...extra,
    });
    const hubRgName = this.cfg.hubVnetId?.split("/")[4] ?? "rg-hub-network";
    const hubName = this.cfg.hubVnetId?.split("/").pop() ?? "vnet-hub";
    const seeds = [
      rg(hubRgName, { env: "prod", owner: "alice@contoso.com", "do-not-delete": "true" }),
      res(hubRgName, VNET_TYPE, hubName, {
        addressSpace: { addressPrefixes: ["10.0.0.0/22"] },
        subnets: [{
          name: "GatewaySubnet",
          id: `${sub}/resourceGroups/${hubRgName}/providers/${VNET_TYPE}/${hubName}/subnets/GatewaySubnet`,
          properties: { addressPrefix: "10.0.0.0/27" },
        }],
      }),
      rg("rg-platform-shared", { env: "prod", owner: "alice@contoso.com" }),
      res("rg-platform-shared", "Microsoft.Compute/disks", "disk-golden-image",
        { diskState: "Unattached", diskSizeGB: 128 }),
      rg("rg-shadow-it", { env: "dev", owner: "mallory@contoso.com" }),
      res("rg-shadow-it", VNET_TYPE, "vnet-shadow", {
        addressSpace: { addressPrefixes: ["10.100.0.0/22"] },
        subnets: [],
      }),
      rg("rg-legacy-app", { env: "dev", owner: "bob@contoso.com" }),
      res("rg-legacy-app", "Microsoft.Compute/disks", "disk-legacy-data",
        { diskState: "Unattached", diskSizeGB: 256 }),
      res("rg-legacy-app", "Microsoft.Compute/disks", "disk-keep-me",
        { diskState: "Unattached", diskSizeGB: 64 }, { "do-not-delete": "true" }),
      res("rg-legacy-app", "Microsoft.Network/publicIPAddresses", "pip-legacy-old",
        { ipAddress: "20.42.10.7", publicIPAllocationMethod: "Static" }),
      res("rg-legacy-app", NIC_TYPE, "nic-legacy-orphan", { ipConfigurations: [] }),
      res("rg-legacy-app", NSG_TYPE, "nsg-legacy-unused", { securityRules: [] }),
      res("rg-legacy-app", "Microsoft.Storage/storageAccounts", "stlegacyexports",
        {}, { "expires-on": "2026-09-30" }, { kind: "StorageV2" }),
      rg("rg-empty-sandbox", { env: "dev", owner: "carol@contoso.com" }),
    ];
    for (const s of seeds) this.save(s);
    this.seedStateTables(sub);
    log("info", "sim_seeded", "Seeded the simulated Azure tenant.", { count: seeds.length });
  }

  private seedStateTables(sub: string) {
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const retired = `${sub}/resourceGroups/rg-retired-app`;
    claimAllocation({
      cidr: "10.100.252.0/24",
      subscriptionId: sub.split("/")[2],
      rgId: retired,
      rgName: "rg-retired-app",
      vnetId: `${retired}/providers/${VNET_TYPE}/vnet-rg-retired-app`,
      source: "simulated-seed",
      allocatedAt: monthAgo,
    }, this.granule);
    const sandbox = `${sub}/resourceGroups/rg-empty-sandbox`;
    writeJson(`rg-inventory/${keyOf(sandbox)}.json`, {
      rgId: sandbox, firstSeen: monthAgo, emptySince: monthAgo,
    });
  }
}

export class SimDirectory implements Directory {
  constructor(private cfg: Config) {}

  async resolveUser(id: string) {
    log("debug", "sim_graph_call", "Simulated Entra ID user lookup.", {
      id_length: id.length,
    });
    const found = this.cfg.simulatedDirectoryUsers.some((u) => eq(u, id));
    return found ? { found, id: `sim-${id.toLowerCase()}`, name: id } : { found };
  }
}
