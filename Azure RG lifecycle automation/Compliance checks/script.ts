import { API, type Arm, type Directory, createClients } from "./arm";
import { overlaps, sameCidr } from "./cidr";
import { type Config, loadConfig } from "./config";
import { jsonFromStdin } from "./http";
import { audit, log, main } from "./log";
import { addRecord, allocationForRg, nowIso } from "./store";

interface Target {
  rgId: string;
  rgName: string;
  subscriptionId: string;
  vnetId: string;
  cidr?: string;
  expectPeering?: boolean;
}

interface CheckResult {
  check: string;
  passed: boolean;
  detail: string;
  remediation?: string;
}

const PEERING_WAIT_MS = 60_000;
const OPEN_SOURCES = new Set(["*", "0.0.0.0/0", "internet", "any"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function result(check: string, passed: boolean, detail: string, remediation: string): CheckResult {
  return passed ? { check, passed, detail } : { check, passed, detail, remediation };
}

function checkIpam(t: Target, vnet: any): CheckResult {
  const alloc = allocationForRg(t.rgId);
  const prefixes: string[] = vnet.properties?.addressSpace?.addressPrefixes ?? [];
  const fix = "Align the VNet address space with the IPAM record, or update the IPAM record after review.";
  if (!alloc) return result("ipam_cidr_match", false, "No active IPAM allocation for this RG.", fix);
  const ok = prefixes.length === 1 && sameCidr(prefixes[0], alloc.cidr);
  const detail = `VNet ${prefixes.join(", ") || "(none)"} vs IPAM ${alloc.cidr}`;
  return result("ipam_cidr_match", ok, detail, fix);
}

async function checkOverlap(arm: Arm, cfg: Config, vnet: any): Promise<CheckResult> {
  const mine: string[] = vnet.properties?.addressSpace?.addressPrefixes ?? [];
  const clashes: string[] = [];
  for (const sub of cfg.subscriptions) {
    const vnets = await arm.list(
      `/subscriptions/${sub}/providers/Microsoft.Network/virtualNetworks`,
      API.network,
    );
    for (const other of vnets) {
      if (eq(other.id, vnet.id)) continue;
      for (const p of other.properties?.addressSpace?.addressPrefixes ?? []) {
        if (mine.some((m) => overlaps(m, p))) clashes.push(`${other.name} (${p})`);
      }
    }
  }
  const detail = clashes.length
    ? `Overlaps with ${clashes.join(", ")}`
    : `No overlap across ${cfg.subscriptions.length} subscription(s)`;
  const fix = "Re-address one of the overlapping VNets and record the change in IPAM.";
  return result("no_vnet_overlap", clashes.length === 0, detail, fix);
}

async function checkPeering(arm: Arm, cfg: Config, t: Target): Promise<CheckResult> {
  if (!t.expectPeering || !cfg.hubVnetId) {
    return result("hub_peering_connected", true, "Not required for this network tier.", "");
  }
  const deadline = Date.now() + PEERING_WAIT_MS;
  let state = "Missing";
  while (true) {
    const vnet = await arm.get(t.vnetId, API.network);
    const peering = (vnet?.properties?.virtualNetworkPeerings ?? []).find((p: any) =>
      eq(p.properties?.remoteVirtualNetwork?.id, cfg.hubVnetId!),
    );
    state = peering?.properties?.peeringState ?? "Missing";
    if (state === "Connected" || Date.now() > deadline) break;
    await sleep(10_000);
  }
  const fix = "Ensure both spoke→hub and hub→spoke peerings exist and the SP has Network Contributor on the hub.";
  return result("hub_peering_connected", state === "Connected", `Hub peering state: ${state}`, fix);
}

function portsOf(rule: any): string[] {
  const p = rule.properties ?? {};
  return [p.destinationPortRange, ...(p.destinationPortRanges ?? [])].filter(Boolean);
}

function coversPort(range: string, port: number) {
  if (range === "*") return true;
  const [lo, hi] = range.split("-").map(Number);
  return hi === undefined ? lo === port : port >= lo && port <= hi;
}

function isOpenSource(rule: any) {
  const p = rule.properties ?? {};
  const sources = [p.sourceAddressPrefix, ...(p.sourceAddressPrefixes ?? [])].filter(Boolean);
  return sources.some((s: string) => OPEN_SOURCES.has(s.toLowerCase()));
}

async function checkMgmtPorts(arm: Arm, cfg: Config, t: Target): Promise<CheckResult> {
  const nsgs = await arm.list(
    `${t.rgId}/providers/Microsoft.Network/networkSecurityGroups`,
    API.network,
  );
  const offenders: string[] = [];
  for (const nsg of nsgs) {
    for (const rule of nsg.properties?.securityRules ?? []) {
      const p = rule.properties ?? {};
      if (p.direction !== "Inbound" || p.access !== "Allow") continue;
      if (!isOpenSource(rule)) continue;
      const hit = cfg.managementPorts.filter((port) => portsOf(rule).some((r) => coversPort(r, port)));
      if (hit.length) offenders.push(`${nsg.name}/${rule.name} (ports ${hit.join(",")})`);
    }
  }
  const detail = offenders.length
    ? `Open to the internet: ${offenders.join("; ")}`
    : `${nsgs.length} NSG(s) checked; no management ports open to 0.0.0.0/0`;
  const fix = "Remove or scope these rules to a bastion/jump-host range; use Azure Bastion or JIT access.";
  return result("nsg_mgmt_ports_closed", offenders.length === 0, detail, fix);
}

function checkSubnets(cfg: Config, vnet: any): CheckResult {
  const problems: string[] = [];
  const subnets = vnet.properties?.subnets ?? [];
  for (const s of subnets) {
    if (!s.properties?.networkSecurityGroup?.id) problems.push(`${s.name}: no NSG`);
    if (cfg.routeTableId && !eq(s.properties?.routeTable?.id, cfg.routeTableId)) {
      problems.push(`${s.name}: route table missing or unexpected`);
    }
  }
  if (!subnets.length) problems.push("VNet has no subnets");
  const rt = cfg.routeTableId ? " and the expected route table" : "";
  const detail = problems.length
    ? problems.join("; ")
    : `All ${subnets.length} subnet(s) have an NSG${rt}`;
  const fix = "Associate a baseline NSG with every subnet and attach the standard route table.";
  return result("subnet_nsg_route_table", problems.length === 0, detail, fix);
}

async function checkOwner(arm: Arm, directory: Directory, t: Target): Promise<CheckResult> {
  const rg = await arm.get(t.rgId, API.resources);
  const tags: Record<string, string> = rg?.tags ?? {};
  const owner = Object.entries(tags).find(([k]) => k.toLowerCase() === "owner")?.[1];
  const fix = "Set the owner tag to the UPN or email of an active Entra ID user.";
  if (!owner) return result("owner_in_entra_id", false, "No owner tag on the RG.", fix);
  const user = await directory.resolveUser(owner);
  const detail = user.found
    ? `Owner ${owner} resolves to an active user`
    : `Owner ${owner} not found or disabled in Entra ID`;
  return result("owner_in_entra_id", user.found, detail, fix);
}

async function evaluate(arm: Arm, directory: Directory, cfg: Config, t: Target) {
  const vnet = await arm.get(t.vnetId, API.network);
  if (!vnet) {
    return [result("vnet_exists", false, `VNet ${t.vnetId} not found`, "Re-run provisioning for this RG.")];
  }
  return [
    checkIpam(t, vnet),
    await checkOverlap(arm, cfg, vnet),
    await checkPeering(arm, cfg, t),
    await checkMgmtPorts(arm, cfg, t),
    checkSubnets(cfg, vnet),
    await checkOwner(arm, directory, t),
  ];
}

function slackMessage(failed: { t: Target; results: CheckResult[] }[], provisionFailures: any[]) {
  const blocks: any[] = [{
    type: "header",
    text: { type: "plain_text", text: ":rotating_light: RG network compliance failures" },
  }];
  for (const { t, results } of failed) {
    const lines = results
      .filter((r) => !r.passed)
      .map((r) => `• *${r.check}* — ${r.detail}\n   _Fix:_ ${r.remediation}`);
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${t.rgName}* (\`${t.subscriptionId}\`)\n${lines.join("\n")}` },
    });
  }
  for (const f of provisionFailures) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*${f.rgName}* — provisioning failed: ${f.error}` },
    });
  }
  const count = failed.length + provisionFailures.length;
  return { kind: "compliance_failure", text: `${count} resource group(s) failed network compliance`, blocks };
}

main("Compliance checks", async () => {
  const input = jsonFromStdin(await Bun.stdin.text());
  const targets: Target[] = input?.rgs ?? [];
  const provisionFailures: any[] = input?.failures ?? [];
  log("info", "compliance_started", "Evaluating network compliance.", {
    count: targets.length, provision_failures: provisionFailures.length,
  });

  const cfg = loadConfig();
  const { arm, directory } = createClients(cfg, { writable: false });
  const evaluationId = `ce-${Date.now().toString(36)}`;
  const failed: { t: Target; results: CheckResult[] }[] = [];

  for (const t of targets) {
    const results = await evaluate(arm, directory, cfg, t);
    addRecord("compliance", { ts: nowIso(), evaluationId, rgId: t.rgId, rgName: t.rgName, results });
    const failures = results.filter((r) => !r.passed).map((r) => r.check);
    const outcome = failures.length ? "failure" : "success";
    log(failures.length ? "warn" : "info", "rg_evaluated", "Evaluated resource group.", {
      rg: t.rgName, passed: results.length - failures.length, failed: failures.length,
    });
    audit("compliance_evaluated", t.rgId, outcome, { evaluation_id: evaluationId, failed_checks: failures });
    if (failures.length) failed.push({ t, results });
  }

  log("info", "compliance_completed", "Finished compliance evaluation.", {
    evaluated: targets.length, failing_rgs: failed.length,
  });
  if (failed.length || provisionFailures.length) {
    process.stdout.write(JSON.stringify(slackMessage(failed, provisionFailures)));
  }
});
