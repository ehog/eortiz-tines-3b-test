import { API, type Arm, createClients } from "./arm";
import { allocateFromPools, overlaps } from "./cidr";
import {
  type Config,
  chooseTemplate,
  ensureConfigFile,
  loadConfig,
  lockGranule,
  wantsNetwork,
} from "./config";
import { jsonFromStdin } from "./http";
import { audit, log, main } from "./log";
import { activeAllocations, allocationForRg, claimAllocation, nowIso } from "./store";

interface RgEvent {
  eventId: string;
  subscriptionId: string;
  rgName: string;
}

export interface Planned {
  eventId: string;
  rgId: string;
  rgName: string;
  subscriptionId: string;
  status: "allocated" | "existing" | "skipped" | "failed";
  location?: string;
  template?: string;
  cidr?: string;
  vnetName?: string;
  vnetId?: string;
  expectPeering?: boolean;
  reason?: string;
}

async function vnetPrefixes(arm: Arm, cfg: Config) {
  const prefixes: string[] = [];
  for (const sub of cfg.subscriptions) {
    const vnets = await arm.list(
      `/subscriptions/${sub}/providers/Microsoft.Network/virtualNetworks`,
      API.network,
    );
    for (const v of vnets) {
      prefixes.push(...(v.properties?.addressSpace?.addressPrefixes ?? []));
    }
  }
  return prefixes;
}

async function plan(arm: Arm, cfg: Config, ev: RgEvent): Promise<Planned> {
  const rgId = `/subscriptions/${ev.subscriptionId}/resourceGroups/${ev.rgName}`;
  const base = { eventId: ev.eventId, rgId, rgName: ev.rgName, subscriptionId: ev.subscriptionId };
  const rg = await arm.get(rgId, API.resources);
  if (!rg) {
    log("warn", "rg_not_found", "Resource group no longer exists; skipping.", { rg: ev.rgName });
    return { ...base, status: "skipped", reason: "Resource group not found" };
  }
  const tags: Record<string, string> = rg.tags ?? {};
  if (!wantsNetwork(tags)) {
    log("warn", "network_not_requested", "Tags opt out of networking.", { rg: ev.rgName });
    return { ...base, status: "skipped", location: rg.location, reason: "network-tier=none or auto-network=false" };
  }

  const { key, template } = chooseTemplate(cfg, tags);
  const vnetName = `vnet-${ev.rgName}`.slice(0, 64);
  const vnetId = `${rgId}/providers/Microsoft.Network/virtualNetworks/${vnetName}`;
  const common = {
    ...base, location: rg.location, template: key, vnetName, vnetId,
    expectPeering: template.peerToHub && !!cfg.hubVnetId,
  };
  const existingAlloc = allocationForRg(rgId);
  const existingVnet = await arm.get(vnetId, API.network);

  if (existingVnet) {
    const cidr = existingVnet.properties?.addressSpace?.addressPrefixes?.[0];
    if (!existingAlloc && cidr) adopt(cfg, ev, rgId, vnetId, cidr);
    log("warn", "network_exists", "VNet already exists; skipping creation.", { rg: ev.rgName, cidr });
    return { ...common, status: "existing", cidr, reason: "VNet already exists" };
  }
  if (existingAlloc) {
    log("info", "allocation_reused", "Reusing the RG's existing allocation.", { rg: ev.rgName, cidr: existingAlloc.cidr });
    return { ...common, status: "allocated", cidr: existingAlloc.cidr };
  }

  const taken = [...activeAllocations().map((a) => a.cidr), ...(await vnetPrefixes(arm, cfg))];
  const cidr = allocateFromPools(cfg.ipamPools, template.vnetPrefix, taken);
  if (!cidr) throw new Error(`IPAM pools exhausted for a /${template.vnetPrefix}`);
  claimAllocation({
    cidr, subscriptionId: ev.subscriptionId, rgId, rgName: ev.rgName, vnetId,
    source: "auto-provision", allocatedAt: nowIso(),
  }, lockGranule(cfg));
  audit("cidr_allocated", rgId, "success", { cidr, template: key });
  log("info", "cidr_allocated", "Allocated address space.", { rg: ev.rgName, cidr });
  return { ...common, status: "allocated", cidr };
}

function adopt(cfg: Config, ev: RgEvent, rgId: string, vnetId: string, cidr: string) {
  const clash = activeAllocations().find((a) => overlaps(a.cidr, cidr));
  if (clash) {
    log("warn", "adopt_conflict", "Existing VNet overlaps another allocation; not recording.", {
      rg: ev.rgName, cidr, other: clash.rgName,
    });
    return;
  }
  claimAllocation({
    cidr, subscriptionId: ev.subscriptionId, rgId, rgName: ev.rgName, vnetId,
    source: "adopted", allocatedAt: nowIso(),
  }, lockGranule(cfg));
  audit("cidr_adopted", rgId, "success", { cidr });
}

main("Allocate CIDR", async () => {
  const input = jsonFromStdin(await Bun.stdin.text());
  const events: RgEvent[] = input?.events ?? [];
  log("info", "allocate_started", "Planning networks for resource group events.", { count: events.length });
  if (!events.length) return;

  ensureConfigFile();
  const cfg = loadConfig();
  const { arm } = createClients(cfg, { writable: true });
  const planned: Planned[] = [];
  for (const ev of events) {
    try {
      planned.push(await plan(arm, cfg, ev));
    } catch (err) {
      const reason = (err as Error).message;
      const rgId = `/subscriptions/${ev.subscriptionId}/resourceGroups/${ev.rgName}`;
      log("error", "allocate_failed", "Could not plan the network.", { rg: ev.rgName, error: reason });
      audit("cidr_allocated", rgId, "failure", { error: reason });
      planned.push({ eventId: ev.eventId, rgId, rgName: ev.rgName, subscriptionId: ev.subscriptionId, status: "failed", reason });
    }
  }
  const counts: Record<string, number> = {};
  for (const p of planned) counts[p.status] = (counts[p.status] ?? 0) + 1;
  log("info", "allocate_completed", "Finished planning networks.", counts);
  process.stdout.write(JSON.stringify({ planned }));
});
