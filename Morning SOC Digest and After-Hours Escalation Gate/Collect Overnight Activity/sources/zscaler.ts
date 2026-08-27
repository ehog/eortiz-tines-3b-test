import { choice, timeIn, USERS, HOSTS, type MockWindow } from "./mockutil";

/**
 * Mock Zscaler Internet Access web/security logs.
 * Real swap: POST {ZSCALER_URL}/api/v1/webinsights/logs with a time filter for the collection window
 * (or the NSS feed) with the Zscaler connector attached.
 */
export function fetchZscaler({ start, end, rng }: MockWindow) {
  const templates = [
    { title: "Blocked connection to newly registered domain", severity: "Medium", confidence: "medium", action: "Blocked", impact: "internal_only" },
    { title: "Command-and-control callback blocked", severity: "High", confidence: "high", action: "Blocked", impact: "customer_data" },
    { title: "Cryptomining traffic detected", severity: "Medium", confidence: "high", action: "Blocked", impact: "none" },
    { title: "Large upload to unsanctioned file sharing site", severity: "High", confidence: "medium", action: "Allowed", impact: "customer_data" },
    { title: "Policy violation: streaming category", severity: "Low", confidence: "low", action: "Blocked", impact: "none" },
  ];
  const count = 5 + Math.floor(rng() * 5);
  return Array.from({ length: count }, (_, i) => {
    const t = choice(rng, templates);
    return {
      source: "zscaler",
      id: `zs-${771000 + Math.floor(rng() * 900)}-${i}`,
      title: t.title,
      description: `Web transaction ${t.action.toLowerCase()} by ZIA policy; ${Math.floor(rng() * 900) + 20} KB transferred.`,
      severity: t.severity,
      confidence: t.confidence,
      hostname: choice(rng, HOSTS),
      user: choice(rng, USERS),
      url: choice(rng, ["cdn-update.example", "files-drop.example", "pool.miner.example", "stream-hub.example"]),
      businessImpact: t.impact,
      time: timeIn(rng, start, end),
      state: t.action === "Blocked" ? "Auto-mitigated" : "Open",
      tags: ["zscaler", t.action.toLowerCase()],
    };
  });
}
