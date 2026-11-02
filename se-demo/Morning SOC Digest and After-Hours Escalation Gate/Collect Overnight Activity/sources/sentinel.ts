import { choice, timeIn, USERS, HOSTS, type MockWindow } from "./mockutil";

/**
 * Mock Microsoft Sentinel incidents.
 * Real swap: GET {SENTINEL_URL}/subscriptions/.../providers/Microsoft.SecurityInsights/incidents
 * ?$filter=properties/lastModifiedTimeUtc ge {windowStart} with the Microsoft Sentinel connector attached.
 */
export function fetchSentinel({ start, end, rng }: MockWindow) {
  const templates = [
    { title: "Impossible travel sign-in detected", severity: "High", confidence: "high", tactic: "InitialAccess", impact: "customer_data" },
    { title: "Multiple failed MFA challenges followed by success", severity: "High", confidence: "medium", tactic: "CredentialAccess", impact: "internal_only" },
    { title: "Anomalous mailbox rule creation", severity: "Medium", confidence: "medium", tactic: "Persistence", impact: "internal_only" },
    { title: "Sign-in from anonymised IP address", severity: "Medium", confidence: "low", tactic: "InitialAccess", impact: "internal_only" },
    { title: "Mass download from SharePoint by single account", severity: "High", confidence: "high", tactic: "Exfiltration", impact: "customer_data" },
    { title: "Legacy authentication protocol used", severity: "Low", confidence: "low", tactic: "InitialAccess", impact: "none" },
  ];
  const count = 5 + Math.floor(rng() * 4);
  return Array.from({ length: count }, (_, i) => {
    const t = choice(rng, templates);
    const closed = rng() < 0.3;
    return {
      source: "sentinel",
      id: `INC-${55000 + Math.floor(rng() * 900)}-${i}`,
      title: t.title,
      description: `${t.tactic} detection raised by Sentinel analytics rule "${t.title}".`,
      severity: t.severity,
      confidence: t.confidence,
      user: choice(rng, USERS),
      hostname: choice(rng, HOSTS),
      indicator: `${Math.floor(rng() * 200) + 20}.${Math.floor(rng() * 255)}.${Math.floor(rng() * 255)}.${Math.floor(rng() * 255)}`,
      businessImpact: t.impact,
      createdAt: timeIn(rng, start, end),
      status: closed ? "Closed" : "Active",
      classification: closed ? (rng() < 0.5 ? "BenignPositive" : "FalsePositive") : null,
      tags: ["sentinel", t.tactic.toLowerCase()],
    };
  });
}
