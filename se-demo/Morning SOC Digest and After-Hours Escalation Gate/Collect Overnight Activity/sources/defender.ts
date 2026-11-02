import { choice, timeIn, USERS, HOSTS, type MockWindow } from "./mockutil";

/**
 * Mock Microsoft Defender for Endpoint alerts.
 * Real swap: GET https://api.securitycenter.microsoft.com/api/alerts?$filter=alertCreationTime gt {windowStart}
 * with the Microsoft Defender for Endpoint connector attached.
 */
export function fetchDefender({ start, end, rng }: MockWindow) {
  const templates = [
    { title: "Ransomware pre-encryption behaviour detected", severity: "Critical", confidence: "confirmed", category: "Ransomware", impact: "revenue_impacting" },
    { title: "Suspicious PowerShell download cradle", severity: "High", confidence: "high", category: "Execution", impact: "customer_data" },
    { title: "Credential dumping attempt against LSASS", severity: "High", confidence: "high", category: "CredentialAccess", impact: "internal_only" },
    { title: "Potentially unwanted application blocked", severity: "Low", confidence: "medium", category: "Malware", impact: "none" },
    { title: "Suspicious scheduled task registration", severity: "Medium", confidence: "medium", category: "Persistence", impact: "internal_only" },
    { title: "Malicious file quarantined by cloud protection", severity: "Medium", confidence: "confirmed", category: "Malware", impact: "internal_only" },
  ];
  const count = 4 + Math.floor(rng() * 4);
  return Array.from({ length: count }, (_, i) => {
    const t = choice(rng, templates);
    const resolved = rng() < 0.35;
    return {
      source: "defender",
      id: `da-${88000 + Math.floor(rng() * 400)}-${i}`,
      title: t.title,
      description: `${t.category} alert on endpoint; automated investigation ${resolved ? "remediated the threat" : "requires analyst review"}.`,
      severity: t.severity,
      confidence: t.confidence,
      deviceName: choice(rng, HOSTS),
      userName: choice(rng, USERS),
      sha256: Array.from({ length: 16 }, () => Math.floor(rng() * 16).toString(16)).join("") + "b91f3c2d7a48e510",
      businessImpact: t.impact,
      alertCreationTime: timeIn(rng, start, end),
      status: resolved ? "Resolved" : "New",
      determination: resolved ? "Remediated by automated investigation" : null,
      tags: ["defender", t.category.toLowerCase()],
    };
  });
}
