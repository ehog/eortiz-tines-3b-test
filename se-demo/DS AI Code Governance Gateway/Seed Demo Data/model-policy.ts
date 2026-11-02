export const MODELS = ["claude-sonnet-4-5", "gpt-4o", "gemini-2.5-pro", "azure-foundry-claude"] as const;
export const TEAMS = ["R&D-Endodontics", "Digital Dentistry", "IT-Ops", "Clinical Data"] as const;
export const REGIONS = ["US", "DE", "JP"] as const;

export type Rule = {
  id: string;
  team: string;
  region: string;
  allowed: string[];
  rationale: string;
};

export const POLICY_VERSION = "2026.02-r3";

export const RULES: Rule[] = [
  { id: "MP-001", team: "Clinical Data", region: "US", allowed: ["azure-foundry-claude"], rationale: "PHI in scope — HIPAA BAA covers Azure AI Foundry tenancy only." },
  { id: "MP-002", team: "Clinical Data", region: "DE", allowed: ["azure-foundry-claude"], rationale: "GDPR Art. 9 health data — EU-resident Foundry deployment only." },
  { id: "MP-003", team: "Clinical Data", region: "JP", allowed: ["azure-foundry-claude"], rationale: "APPI sensitive personal information — Foundry (Japan East) only." },
  { id: "MP-010", team: "R&D-Endodontics", region: "US", allowed: ["claude-sonnet-4-5", "azure-foundry-claude"], rationale: "Design IP — enterprise no-training agreements only." },
  { id: "MP-011", team: "R&D-Endodontics", region: "DE", allowed: ["claude-sonnet-4-5", "azure-foundry-claude"], rationale: "gpt-4o not approved for EU R&D IP pending DPIA sign-off." },
  { id: "MP-012", team: "R&D-Endodontics", region: "JP", allowed: ["claude-sonnet-4-5", "azure-foundry-claude"], rationale: "Design IP — enterprise no-training agreements only." },
  { id: "MP-020", team: "Digital Dentistry", region: "US", allowed: ["claude-sonnet-4-5", "gpt-4o", "gemini-2.5-pro", "azure-foundry-claude"], rationale: "Non-regulated product surface — all reviewed models permitted." },
  { id: "MP-021", team: "Digital Dentistry", region: "DE", allowed: ["claude-sonnet-4-5", "gpt-4o", "azure-foundry-claude"], rationale: "gemini-2.5-pro lacks EU data-residency addendum." },
  { id: "MP-022", team: "Digital Dentistry", region: "JP", allowed: ["claude-sonnet-4-5", "gpt-4o", "azure-foundry-claude"], rationale: "gemini-2.5-pro lacks APPI transfer assessment." },
  { id: "MP-030", team: "IT-Ops", region: "US", allowed: ["claude-sonnet-4-5", "gpt-4o", "azure-foundry-claude"], rationale: "Infrastructure automation — audited vendors only." },
  { id: "MP-031", team: "IT-Ops", region: "DE", allowed: ["claude-sonnet-4-5", "azure-foundry-claude"], rationale: "EU infrastructure automation restricted to EU-hosted endpoints." },
  { id: "MP-032", team: "IT-Ops", region: "JP", allowed: ["claude-sonnet-4-5", "azure-foundry-claude"], rationale: "APAC infrastructure automation restricted to audited vendors." },
];

export function findRule(team: string, region: string): Rule | undefined {
  return RULES.find((r) => r.team === team && r.region === region);
}

export type ModelPolicyResult = {
  policy_version: string;
  compliant: boolean;
  rule_id: string | null;
  rule_fired: string | null;
  allowed_models: string[];
  model_used: string;
  message: string;
  rationale: string | null;
};

export function evaluateModelPolicy(team: string, region: string, model: string): ModelPolicyResult {
  const rule = findRule(team, region);
  if (!rule) {
    return {
      policy_version: POLICY_VERSION,
      compliant: false,
      rule_id: "MP-000",
      rule_fired: "MP-000 default-deny (no policy row for team/region)",
      allowed_models: [],
      model_used: model,
      message: `No model policy defined for ${team} / ${region} — default deny.`,
      rationale: "Unmapped team/region combinations are denied by default.",
    };
  }
  const compliant = rule.allowed.includes(model);
  return {
    policy_version: POLICY_VERSION,
    compliant,
    rule_id: rule.id,
    rule_fired: compliant ? null : `${rule.id} ${team} / ${region} allows [${rule.allowed.join(", ")}]`,
    allowed_models: rule.allowed,
    model_used: model,
    message: compliant
      ? `${model} permitted for ${team} / ${region} under ${rule.id}.`
      : `${model} is NOT permitted for ${team} / ${region} — violates ${rule.id}.`,
    rationale: rule.rationale,
  };
}
