import { shiftIso } from "./lib";
import { indicatorList } from "./client";
import { seeded, sleep, type CollectContext, type CollectResult } from "./support";

const ACTORS = ["TA577", "FIN7", "Storm-1811", "unattributed commodity loader"];
const FAMILIES = ["QakBot", "IcedID", "DarkGate", "Latrodectus", "none observed"];

export async function mockThreatIntel(context: CollectContext): Promise<CollectResult> {
  const { incident, audit } = context;
  const random = seeded(`${incident.investigationId}:threatintel`);
  const targets = indicatorList(context);
  const list = targets.length
    ? targets
    : [
        { value: "203.0.113.47", type: "ip", path: "" },
        { value: "cdn-update-delivery.net", type: "domain", path: "" },
        { value: "9f2c3e6a4bd8177f4b2c0aa5d7311e8ce2a4f6b9c0d1e2f3a4b5c6d7e8f90112", type: "file", path: "" },
      ];

  await sleep(random.int(300, 900));

  const indicators = list.map((indicator, index) => {
    const malicious = index === 0 ? random.int(18, 46) : random.int(0, 40);
    const verdict = malicious > 12 ? "malicious" : malicious > 3 ? "suspicious" : "no detections";
    return {
      indicator: indicator.value,
      type: indicator.type,
      verdict,
      malicious,
      suspicious: random.int(0, 6),
      harmless: random.int(20, 60),
      reputation: verdict === "malicious" ? -random.int(30, 90) : random.int(-5, 20),
      confidence: verdict === "malicious" ? random.int(75, 96) : random.int(20, 60),
      firstSeen: shiftIso(incident.alertTime, -random.int(1440, 43200)),
      lastSeen: shiftIso(incident.alertTime, -random.int(1, 240)),
      registrar: indicator.type === "domain" ? random.pick(["NameSilo", "Namecheap", "Porkbun"]) : null,
      domainAgeDays: indicator.type === "domain" ? random.int(1, 21) : null,
      asn: indicator.type === "ip" ? `AS${random.int(20000, 65000)} ${random.pick(["Stark Industries Solutions", "Hostinger", "Chang Way Technologies"])}` : null,
      malwareFamily: verdict === "malicious" ? random.pick(FAMILIES.slice(0, 4)) : "none observed",
      actor: verdict === "malicious" ? random.pick(ACTORS) : "unattributed",
      sources: ["VirusTotal", "AlienVault OTX", "Internal blocklist"].slice(0, random.int(1, 3)),
      tags: verdict === "malicious" ? ["phishing", "loader", "recent-registration"].slice(0, random.int(1, 3)) : [],
    };
  });

  for (const indicator of indicators) {
    audit.log("threatintel_lookup", indicator.indicator, `verdict=${indicator.verdict}`, random.int(120, 620));
  }

  const events: CollectResult["events"] = indicators
    .filter((indicator) => indicator.verdict !== "no detections")
    .slice(0, 8)
    .map((indicator) => ({
      ts: indicator.lastSeen,
      title: `${indicator.verdict === "malicious" ? "Malicious" : "Suspicious"} ${indicator.type}: ${indicator.indicator}`,
      detail: [
        `${indicator.malicious} engines malicious`,
        `confidence ${indicator.confidence}%`,
        indicator.malwareFamily !== "none observed" ? `family ${indicator.malwareFamily}` : null,
        indicator.domainAgeDays !== null ? `domain registered ${indicator.domainAgeDays} days ago` : null,
        indicator.asn ? `hosted on ${indicator.asn}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      entity: indicator.indicator,
      severity: indicator.verdict === "malicious" ? "high" : "medium",
    }));

  return {
    data: {
      indicators,
      summary: {
        checked: indicators.length,
        malicious: indicators.filter((i) => i.verdict === "malicious").length,
        suspicious: indicators.filter((i) => i.verdict === "suspicious").length,
        clean: indicators.filter((i) => i.verdict === "no detections").length,
      },
    },
    events,
    recordCount: indicators.length,
  };
}
