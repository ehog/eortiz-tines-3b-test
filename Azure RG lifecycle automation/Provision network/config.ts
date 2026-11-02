import { existsSync, readFileSync, writeFileSync } from "node:fs";

export const STATE_DIR = "/storage/rglc";
export const CONFIG_PATH = `${STATE_DIR}/config.json`;

export interface SubnetSpec {
  name: string;
  prefix: number;
}

export interface NetworkTemplate {
  vnetPrefix: number;
  peerToHub: boolean;
  subnets: SubnetSpec[];
}

export interface Config {
  simulate: boolean;
  subscriptions: string[];
  ipamPools: string[];
  hubVnetId: string | null;
  routeTableId: string | null;
  protectedResourceGroups: string[];
  templates: Record<string, NetworkTemplate>;
  defaultTemplate: string;
  managementPorts: number[];
  emptyRgMinAgeDays: number;
  maxCleanupItems: number;
  slack: { enabled: boolean; channel: string };
  simulatedDirectoryUsers: string[];
}

const TEST_SUB = "11111111-2222-3333-4444-555555555555";

export const DEFAULT_CONFIG: Config = {
  simulate: true,
  subscriptions: [TEST_SUB],
  ipamPools: ["10.100.0.0/16"],
  hubVnetId:
    `/subscriptions/${TEST_SUB}/resourceGroups/rg-hub-network` +
    "/providers/Microsoft.Network/virtualNetworks/vnet-hub",
  routeTableId: null,
  protectedResourceGroups: [
    "rg-hub-network",
    "rg-platform-shared",
    "NetworkWatcherRG",
  ],
  templates: {
    prod: {
      vnetPrefix: 22,
      peerToHub: true,
      subnets: [
        { name: "app", prefix: 24 },
        { name: "data", prefix: 24 },
        { name: "mgmt", prefix: 26 },
      ],
    },
    staging: {
      vnetPrefix: 23,
      peerToHub: true,
      subnets: [
        { name: "app", prefix: 24 },
        { name: "data", prefix: 25 },
        { name: "mgmt", prefix: 26 },
      ],
    },
    dev: {
      vnetPrefix: 24,
      peerToHub: true,
      subnets: [
        { name: "app", prefix: 25 },
        { name: "data", prefix: 26 },
        { name: "mgmt", prefix: 27 },
      ],
    },
    isolated: {
      vnetPrefix: 24,
      peerToHub: false,
      subnets: [
        { name: "app", prefix: 25 },
        { name: "data", prefix: 26 },
      ],
    },
  },
  defaultTemplate: "dev",
  managementPorts: [22, 3389],
  emptyRgMinAgeDays: 7,
  maxCleanupItems: 100,
  slack: { enabled: false, channel: "#cloud-ops" },
  simulatedDirectoryUsers: [
    "alice@contoso.com",
    "bob@contoso.com",
    "carol@contoso.com",
  ],
};

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG;
  const stored = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  return { ...DEFAULT_CONFIG, ...stored };
}

export function ensureConfigFile() {
  if (existsSync(CONFIG_PATH)) return;
  writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
}

export function chooseTemplate(cfg: Config, tags: Record<string, string>) {
  const tier = tags["network-tier"]?.toLowerCase();
  const env = tags["env"]?.toLowerCase();
  const key =
    (tier && cfg.templates[tier] && tier) ||
    (env && cfg.templates[env] && env) ||
    cfg.defaultTemplate;
  return { key, template: cfg.templates[key] };
}

export function wantsNetwork(tags: Record<string, string>) {
  const tier = tags["network-tier"]?.toLowerCase();
  const auto = tags["auto-network"]?.toLowerCase();
  return tier !== "none" && auto !== "false";
}

export function isProtectedRg(
  cfg: Config,
  name: string,
  tags: Record<string, string> | undefined,
) {
  const lower = name.toLowerCase();
  const listed = cfg.protectedResourceGroups.some(
    (p) => p.toLowerCase() === lower,
  );
  return listed || isDoNotDelete(tags);
}

export function isDoNotDelete(tags: Record<string, string> | undefined) {
  if (!tags) return false;
  return Object.entries(tags).some(
    ([k, v]) => k.toLowerCase() === "do-not-delete" && v.toLowerCase() === "true",
  );
}

export function lockGranule(cfg: Config) {
  return Math.max(...Object.values(cfg.templates).map((t) => t.vnetPrefix));
}
