import { API, type Arm, createClients } from "./arm";
import { carveSubnets } from "./cidr";
import { type Config, loadConfig } from "./config";
import { jsonFromStdin } from "./http";
import { audit, log, main } from "./log";
import { addRecord, nowIso } from "./store";

interface Planned {
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

type Outcome = Omit<Planned, "status"> & {
  status: "provisioned" | "existing" | "skipped" | "failed";
};

const NET = "providers/Microsoft.Network";

function baselineRules(ports: number[]) {
  return ports.map((port, i) => ({
    name: `deny-internet-${port}`,
    properties: {
      priority: 100 + i * 10,
      direction: "Inbound",
      access: "Deny",
      protocol: "*",
      sourceAddressPrefix: "Internet",
      sourcePortRange: "*",
      destinationAddressPrefix: "*",
      destinationPortRange: String(port),
      description: "Baseline: block management ports from the internet",
    },
  }));
}

async function createNsgs(arm: Arm, cfg: Config, p: Planned, subnets: { name: string }[], tags: object) {
  const ids: Record<string, string> = {};
  for (const s of subnets) {
    const path = `${p.rgId}/${NET}/networkSecurityGroups/nsg-${p.rgName}-${s.name}`;
    const nsg = await arm.put(path, API.network, {
      location: p.location,
      tags,
      properties: { securityRules: baselineRules(cfg.managementPorts) },
    });
    ids[s.name] = nsg.id;
  }
  return ids;
}

async function createVnet(arm: Arm, cfg: Config, p: Planned, subnets: { name: string; cidr: string }[]) {
  const tags = { "managed-by": "rg-lifecycle", "ipam-cidr": p.cidr! };
  const nsgIds = await createNsgs(arm, cfg, p, subnets, tags);
  return arm.put(p.vnetId!, API.network, {
    location: p.location,
    tags,
    properties: {
      addressSpace: { addressPrefixes: [p.cidr] },
      subnets: subnets.map((s) => ({
        name: s.name,
        properties: {
          addressPrefix: s.cidr,
          networkSecurityGroup: { id: nsgIds[s.name] },
          ...(cfg.routeTableId ? { routeTable: { id: cfg.routeTableId } } : {}),
        },
      })),
    },
  });
}

async function peerToHub(arm: Arm, hubId: string, vnetId: string, rgName: string) {
  const link = (remote: string) => ({
    properties: {
      remoteVirtualNetwork: { id: remote },
      allowVirtualNetworkAccess: true,
      allowForwardedTraffic: true,
      useRemoteGateways: false,
      allowGatewayTransit: false,
    },
  });
  await arm.put(`${vnetId}/virtualNetworkPeerings/peer-to-hub`, API.network, link(hubId));
  await arm.put(`${hubId}/virtualNetworkPeerings/${`peer-${rgName}`.slice(0, 80)}`, API.network, link(vnetId));
  log("info", "hub_peering_created", "Created spoke→hub and hub→spoke peerings.", { rg: rgName });
}

async function provision(arm: Arm, cfg: Config, p: Planned): Promise<Outcome> {
  if (p.status !== "allocated") return { ...p, status: p.status };
  const subnets = carveSubnets(p.cidr!, cfg.templates[p.template!].subnets);
  const vnet = await createVnet(arm, cfg, p, subnets);
  if (p.expectPeering) await peerToHub(arm, cfg.hubVnetId!, vnet.id, p.rgName);
  audit("network_provisioned", p.rgId, "success", {
    cidr: p.cidr, template: p.template, subnets: subnets.length, peered: !!p.expectPeering,
  });
  return { ...p, status: "provisioned", vnetId: vnet.id, reason: `Subnets: ${subnets.map((s) => `${s.name} ${s.cidr}`).join(", ")}` };
}

function record(o: Outcome) {
  addRecord("provisioning", {
    ts: nowIso(), eventId: o.eventId, rgId: o.rgId, rgName: o.rgName, location: o.location ?? null,
    template: o.template ?? null, outcome: o.status, cidr: o.cidr ?? null, detail: o.reason ?? "",
  });
}

main("Provision network", async () => {
  const input = jsonFromStdin(await Bun.stdin.text());
  const planned: Planned[] = input?.planned ?? [];
  log("info", "provision_started", "Provisioning planned networks.", { count: planned.length });
  if (!planned.length) return;

  const cfg = loadConfig();
  const { arm } = createClients(cfg, { writable: true });
  const results: Outcome[] = [];
  for (const p of planned) {
    let o: Outcome;
    try {
      o = await provision(arm, cfg, p);
    } catch (err) {
      const reason = (err as Error).message;
      log("error", "provision_failed", "Provisioning failed for resource group.", { rg: p.rgName, error: reason });
      audit("network_provisioned", p.rgId, "failure", { error: reason, cidr: p.cidr });
      o = { ...p, status: "failed", reason };
    }
    record(o);
    results.push(o);
  }

  const toCheck = results.filter((r) => r.status === "provisioned" || r.status === "existing");
  const failures = results.filter((r) => r.status === "failed").map((r) => ({ rgName: r.rgName, error: r.reason }));
  const count = (s: string) => results.filter((r) => r.status === s).length;
  log("info", "provision_completed", "Finished provisioning.", {
    provisioned: count("provisioned"), existing: count("existing"), skipped: count("skipped"), failed: failures.length,
  });
  if (toCheck.length || failures.length) {
    process.stdout.write(JSON.stringify({ rgs: toCheck, failures }));
  }
});
