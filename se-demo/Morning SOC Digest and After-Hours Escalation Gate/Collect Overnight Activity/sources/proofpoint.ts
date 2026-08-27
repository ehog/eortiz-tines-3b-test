import { choice, timeIn, USERS, type MockWindow } from "./mockutil";

/**
 * Mock Proofpoint TAP message events.
 * Real swap: GET https://tap-api-v2.proofpoint.com/v2/siem/all?sinceSeconds={windowSeconds}
 * with the Proofpoint TAP connector attached.
 */
export function fetchProofpoint({ start, end, rng }: MockWindow) {
  const templates = [
    { title: "Credential phishing message delivered then retracted", severity: "High", confidence: "confirmed", threatType: "phish", impact: "internal_only", clicked: true },
    { title: "Malicious attachment blocked at gateway", severity: "Medium", confidence: "confirmed", threatType: "malware", impact: "internal_only", clicked: false },
    { title: "Business email compromise attempt (payment redirect)", severity: "High", confidence: "high", threatType: "impostor", impact: "revenue_impacting", clicked: false },
    { title: "Bulk marketing mail quarantined", severity: "Low", confidence: "low", threatType: "spam", impact: "none", clicked: false },
    { title: "URL rewritten and blocked on click", severity: "Medium", confidence: "high", threatType: "phish", impact: "internal_only", clicked: true },
  ];
  const count = 4 + Math.floor(rng() * 5);
  return Array.from({ length: count }, (_, i) => {
    const t = choice(rng, templates);
    const suppressed = t.threatType === "spam";
    return {
      source: "proofpoint",
      id: `pp-${4100 + Math.floor(rng() * 500)}-${i}`,
      title: t.title,
      description: `${t.threatType} message ${t.clicked ? "was clicked by the recipient" : "was blocked before delivery"}.`,
      severity: t.severity,
      confidence: t.confidence,
      recipient: choice(rng, USERS),
      sender: `${choice(rng, ["billing", "hr-notice", "it-support", "promos"])}@${choice(rng, ["mail-blast.example", "sso-verify.example", "invoice-sync.example"])}`,
      url: choice(rng, ["sso-verify.example/login", "invoice-sync.example/pay", "cdn-update.example/payload.ps1"]),
      businessImpact: t.impact,
      messageTime: timeIn(rng, start, end),
      state: suppressed ? "Auto-quarantined" : "Open",
      tags: ["proofpoint", t.threatType, ...(t.clicked ? ["clicked"] : [])],
    };
  });
}
