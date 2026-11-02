import { intBetween, offsetIso, pick } from "./lib";
import { runSearch } from "./search";

const INCIDENTS = [
  { title: "Multi-stage incident involving Command and Control", severity: "High", tactics: ["CommandAndControl", "Persistence"] },
  { title: "Suspicious outbound traffic to advisory indicator", severity: "Medium", tactics: ["Exfiltration"] },
  { title: "Credential access attempt following phishing click", severity: "High", tactics: ["CredentialAccess", "InitialAccess"] },
  { title: "Threat intelligence match on network traffic", severity: "Medium", tactics: ["Discovery"] },
];

const OWNERS = ["tier2-soc@corp.example.com", "ir-oncall@corp.example.com", null];

const TABLES = ["CommonSecurityLog", "DeviceNetworkEvents", "AzureDiagnostics", "ThreatIntelligenceIndicator", "SigninLogs"];

await runSearch("sentinel", 900, ({ indicator, type, baseIso, next }) => {
  const incidentCount = intBetween(next, 1, 2);
  const incidents = Array.from({ length: incidentCount }, (_, i) => {
    const inc = INCIDENTS[(intBetween(next, 0, INCIDENTS.length - 1) + i) % INCIDENTS.length]!;
    return {
      incidentNumber: intBetween(next, 41000, 41999),
      title: inc.title,
      severity: inc.severity,
      status: pick(next, ["Active", "New", "Active"]),
      owner: OWNERS[intBetween(next, 0, OWNERS.length - 1)],
      tactics: inc.tactics,
      createdAt: offsetIso(baseIso, intBetween(next, 30, 2880)),
      url: `https://portal.azure.com/#view/Microsoft_Azure_Security_Insights/Incident/incidentNumber/${intBetween(next, 41000, 41999)}`,
    };
  });

  const alertCount = intBetween(next, 1, 4);
  const alerts = Array.from({ length: alertCount }, (_, i) => ({
    alertId: `sen_${(Math.floor(next() * 0xffffffff) + 0x10000000).toString(16)}`,
    name: pick(next, [
      "TI map IP entity to CommonSecurityLog",
      "TI map Domain entity to DnsEvents",
      "TI map File Hash to DeviceFileEvents",
      "Anomalous sign-in followed by outbound beacon",
    ]),
    severity: pick(next, ["High", "Medium", "Medium", "Low"]),
    generatedAt: offsetIso(baseIso, intBetween(next, 20, 4320) + i),
    table: pick(next, TABLES),
  }));

  const logRowCount = intBetween(next, 4, 240);
  const entities = [
    { type: type === "sha1" || type === "sha256" ? "FileHash" : type === "url" ? "Url" : type === "domain" ? "DnsResolution" : "Ip", value: indicator },
    { type: "Host", value: pick(next, ["FIN-WKS-0142", "OPS-SRV-DB03", "ENG-MBP-0231"]) },
    { type: "Account", value: pick(next, ["j.mercer@corp.example.com", "s.raymond@corp.example.com"]) },
  ];

  const stamps = [...alerts.map((a) => a.generatedAt), ...incidents.map((i) => i.createdAt)].sort();

  return {
    findings: {
      workspace: "corp-soc-law-eastus",
      queriedTables: TABLES,
      matchedLogRows: logRowCount,
      incidents,
      alerts,
      entities,
    },
    frequency: logRowCount,
    firstSeen: stamps[0]!,
    lastSeen: stamps[stamps.length - 1]!,
  };
});
