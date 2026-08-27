import { choice, timeIn, USERS, HOSTS, type MockWindow } from "./mockutil";

/**
 * Mock ServiceNow security incidents.
 * Real swap: GET {SERVICE_NOW_URL}/api/now/table/sn_si_incident?sysparm_query=sys_created_on>{windowStart}
 * with the ServiceNow connector attached.
 */
export function fetchServiceNow({ start, end, rng }: MockWindow) {
  const templates = [
    { title: "User reported credential phishing with entered password", priority: "2", confidence: "confirmed", impact: "internal_only" },
    { title: "Lost corporate laptop reported", priority: "3", confidence: "confirmed", impact: "customer_data" },
    { title: "Access request flagged for privileged group", priority: "3", confidence: "medium", impact: "internal_only" },
    { title: "Suspicious invoice email reported by finance", priority: "2", confidence: "high", impact: "revenue_impacting" },
    { title: "Endpoint agent offline for more than 24 hours", priority: "4", confidence: "low", impact: "none" },
  ];
  const count = 3 + Math.floor(rng() * 3);
  return Array.from({ length: count }, (_, i) => {
    const t = choice(rng, templates);
    const closed = rng() < 0.4;
    return {
      source: "servicenow",
      id: `INC00${92000 + Math.floor(rng() * 800)}${i}`,
      title: t.title,
      description: `Security incident raised in ServiceNow; assignment group SOC-Tier1. ${closed ? "Closed by automation rule." : "Awaiting triage."}`,
      priority: t.priority,
      confidence: t.confidence,
      user: choice(rng, USERS),
      hostname: choice(rng, HOSTS),
      businessImpact: t.impact,
      sys_created_on: timeIn(rng, start, end),
      state: closed ? "Closed" : "New",
      close_notes: closed ? "Auto-closed: duplicate of an existing SOC incident." : null,
      tags: ["servicenow"],
    };
  });
}
