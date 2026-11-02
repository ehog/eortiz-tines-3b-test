export type ScenarioAlert = Record<string, unknown>;

export type Scenario = {
  id: string;
  name: string;
  description: string;
  alerts: ScenarioAlert[];
};

/** One-click demo scenarios. Each produces vendor-shaped payloads that the normalizer flattens. */
export const SCENARIOS: Scenario[] = [
  {
    id: "critical_asset_ransomware",
    name: "Critical asset ransomware",
    description: "Tier 0 payment database showing ransomware pre-encryption behaviour — should page immediately.",
    alerts: [
      {
        source: "defender",
        id: "da-88121",
        title: "Ransomware pre-encryption behaviour detected (shadow copy deletion)",
        description: "vssadmin.exe delete shadows /all /quiet executed by svc_backup on pay-db-01.",
        severity: "critical",
        confidence: "confirmed",
        hostname: "pay-db-01",
        user: "svc_backup",
        indicator: "vssadmin.exe delete shadows",
        businessImpact: "revenue_impacting",
        tags: ["ransomware", "pci"],
      },
    ],
  },
  {
    id: "noisy_low_sev_phishing",
    name: "Noisy low-sev phishing burst",
    description: "Five low-severity Proofpoint bulk-mail alerts that should be auto-suppressed, not paged.",
    alerts: Array.from({ length: 5 }, (_, i) => ({
      source: "proofpoint",
      id: `pp-bulk-${4100 + i}`,
      title: "Bulk marketing mail quarantined",
      description: "Message quarantined by bulk mail policy; no user interaction recorded.",
      severity: "low",
      confidence: "low",
      recipient: ["dana.reyes", "sam.oyelaran", "priya.nair", "tom.becker", "lena.fischer"][i],
      sender: `promos${i}@mail-blast.example`,
      businessImpact: "none",
      tags: ["bulk", "auto-quarantined"],
    })),
  },
  {
    id: "correlated_user_host",
    name: "Correlated user + host across 3 sources",
    description: "Sentinel, Defender and Zscaler all firing on dana.reyes / ehr-prod-03 — one entity, three sources.",
    alerts: [
      {
        source: "sentinel",
        id: "inc-55021",
        title: "Impossible travel sign-in for dana.reyes",
        description: "Successful sign-in from Lagos, NG 14 minutes after a Phoenix, AZ sign-in.",
        severity: "high",
        confidence: "high",
        user: "dana.reyes",
        hostname: "ehr-prod-03",
        indicator: "102.89.44.17",
        businessImpact: "customer_data",
        tags: ["identity", "phi"],
      },
      {
        source: "defender",
        id: "da-88134",
        title: "Suspicious PowerShell download cradle on ehr-prod-03",
        description: "powershell.exe -enc IEX(New-Object Net.WebClient).DownloadString executed under dana.reyes.",
        severity: "high",
        confidence: "high",
        hostname: "ehr-prod-03",
        user: "dana.reyes",
        indicator: "hxxp://cdn-update[.]example/payload.ps1",
        businessImpact: "customer_data",
        tags: ["execution"],
      },
      {
        source: "zscaler",
        id: "zs-771903",
        title: "Blocked connection to newly registered domain",
        description: "ehr-prod-03 attempted egress to cdn-update.example (registered 3 days ago).",
        severity: "medium",
        confidence: "medium",
        hostname: "ehr-prod-03",
        user: "dana.reyes",
        url: "cdn-update.example",
        businessImpact: "customer_data",
        tags: ["egress", "blocked"],
      },
    ],
  },
  {
    id: "borderline_threshold",
    name: "Borderline score at threshold",
    description: "A medium/high alert on a tier 2 host that lands within a few points of the page threshold.",
    alerts: [
      {
        source: "sentinel",
        id: "inc-55044",
        title: "Multiple failed MFA challenges followed by success",
        description: "9 failed MFA pushes then an accepted push for tom.becker on build-agent-11.",
        severity: "high",
        confidence: "medium",
        user: "tom.becker",
        hostname: "build-agent-11",
        indicator: "198.51.100.77",
        businessImpact: "internal_only",
        tags: ["mfa-fatigue"],
      },
    ],
  },
  {
    id: "unknown_asset_high_sev",
    name: "High severity on an unknown asset",
    description: "Shows how a host missing from the mock CMDB scores against the 'unknown' tier.",
    alerts: [
      {
        source: "servicenow",
        id: "INC0092312",
        title: "User reported credential phishing with entered password",
        description: "User confirmed entering corporate credentials on a spoofed SSO page.",
        severity: "high",
        confidence: "confirmed",
        user: "lena.fischer",
        hostname: "lap-lf-2291",
        indicator: "sso-verify.example",
        businessImpact: "internal_only",
        tags: ["credential-theft"],
      },
    ],
  },
];
