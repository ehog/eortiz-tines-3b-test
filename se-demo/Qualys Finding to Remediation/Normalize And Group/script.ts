// Normalizes Qualys detections into the canonical finding shape, attributes each
// one to an owning application/team via the asset-owner lookup, and groups them
// by asset and then by team.
import owners from "./asset-owners.json" with { type: "json" };
import { runStage } from "./stage";
import type {
  AssetGroup,
  Envelope,
  NormalizedFinding,
  Owner,
  PullEnvelope,
  QualysDetection,
  TeamGroup,
} from "./types";

type OwnerEntry = {
  application: string;
  team: string;
  assignment_group: string;
  owner_email: string;
  criticality: Owner["criticality"];
  exposure: Owner["exposure"];
  environment: string;
};

const ASSETS = owners.assets as Record<string, OwnerEntry>;
const FALLBACK = owners.fallback as OwnerEntry;
const BY_HOSTNAME = new Map(Object.entries(ASSETS).map(([k, v]) => [k.toUpperCase(), v]));
const VALID_EXPOSURE = new Set(["internet", "dmz", "internal", "isolated"]);
const VALID_TYPES = new Set(["missing_patch", "third_party_library", "code", "config", "unknown"]);

function resolveOwner(d: QualysDetection): Owner {
  const entry = BY_HOSTNAME.get(d.ASSET.HOSTNAME.toUpperCase());
  const base = entry ?? FALLBACK;
  const override = d.ASSET.EXPOSURE_OVERRIDE;
  const exposure =
    override && VALID_EXPOSURE.has(override) ? (override as Owner["exposure"]) : base.exposure;
  return {
    asset_id: d.ASSET.ASSET_ID || null,
    hostname: d.ASSET.HOSTNAME,
    application: base.application,
    team: base.team,
    assignment_group: base.assignment_group,
    owner_email: base.owner_email,
    criticality: base.criticality,
    exposure,
    environment: base.environment,
    owned: entry !== undefined,
  };
}

function normalize(d: QualysDetection): NormalizedFinding {
  const findingType = VALID_TYPES.has(d.FINDING_TYPE)
    ? (d.FINDING_TYPE as NormalizedFinding["finding_type"])
    : "unknown";
  return {
    finding_id: d.ID,
    qid: d.QID,
    title: d.TITLE,
    vuln_class: d.VULN_CLASS,
    finding_type: findingType,
    severity: d.SEVERITY,
    cvss_base: d.CVSS.BASE,
    cvss_temporal: d.CVSS.TEMPORAL,
    cvss_vector: d.CVSS.VECTOR,
    cves: d.CVE_LIST ?? [],
    kev: d.THREAT_INTEL?.KNOWN_EXPLOITED === true,
    exploit_in_wild: d.THREAT_INTEL?.EXPLOIT_IN_THE_WILD === true,
    kev_due_date: d.THREAT_INTEL?.CISA_KEV_DUE_DATE ?? null,
    patch_available: d.PATCH_AVAILABLE === true,
    status: d.STATUS,
    detection_type: d.TYPE,
    asset: {
      asset_id: d.ASSET.ASSET_ID,
      hostname: d.ASSET.HOSTNAME,
      ip: d.ASSET.IP,
      os: d.ASSET.OS,
      tags: d.ASSET.TAGS ?? [],
    },
    software: d.SOFTWARE ?? {},
    evidence: d.RESULTS ?? "",
    vendor_solution: d.SOLUTION ?? "",
    first_found: d.FIRST_FOUND_DATETIME,
    last_found: d.LAST_FOUND_DATETIME,
    last_updated: d.LAST_UPDATE_DATETIME,
    times_detected: d.TIMES_DETECTED,
    owner: resolveOwner(d),
  };
}

function group(findings: NormalizedFinding[]): TeamGroup[] {
  const teams = new Map<string, TeamGroup>();
  for (const f of findings) {
    const key = `${f.owner.team}::${f.owner.application}`;
    let team = teams.get(key);
    if (!team) {
      team = {
        team: f.owner.team,
        application: f.owner.application,
        assignment_group: f.owner.assignment_group,
        owner_email: f.owner.owner_email,
        owned: f.owner.owned,
        finding_ids: [],
        assets: [],
      };
      teams.set(key, team);
    }
    team.finding_ids.push(f.finding_id);
    if (!f.owner.owned) team.owned = false;
    let asset = team.assets.find((a) => a.hostname === f.asset.hostname);
    if (!asset) {
      asset = {
        asset_id: f.asset.asset_id,
        hostname: f.asset.hostname,
        os: f.asset.os,
        finding_ids: [],
      };
      team.assets.push(asset);
    }
    asset.finding_ids.push(f.finding_id);
  }
  return [...teams.values()].sort((a, b) => b.finding_ids.length - a.finding_ids.length);
}

await runStage<PullEnvelope, Envelope>({
  stage: "normalize",
  upstreamStage: "pull",
  handler: async (input, { runId, invocation }) => {
    const detections = input?.detections ?? [];
    const findings = detections.map(normalize);
    const groups = group(findings);
    const unowned = findings.filter((f) => !f.owner.owned);
    const payload: Envelope = {
      run_id: input?.run_id ?? runId,
      trigger: input?.trigger ?? invocation.trigger,
      stage: "normalize",
      generated_at: input?.generated_at ?? new Date().toISOString(),
      findings,
      groups,
      tickets: [],
      notes: [
        `${findings.length} findings normalized across ${new Set(findings.map((f) => f.asset.hostname)).size} assets`,
        `${groups.length} owning team/application groups`,
        unowned.length
          ? `${unowned.length} findings on assets absent from the owner map, routed to ${FALLBACK.team}: ${unowned
              .map((f) => `${f.finding_id}@${f.asset.hostname}`)
              .join(", ")}`
          : "every asset matched the owner map",
      ],
    };
    return {
      payload,
      count: findings.length,
      summary: `${findings.length} findings in ${groups.length} team groups (${unowned.length} unowned)`,
      emit: findings.length > 0,
    };
  },
});
