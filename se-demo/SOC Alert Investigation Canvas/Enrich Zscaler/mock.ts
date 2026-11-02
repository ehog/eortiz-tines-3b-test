import { shiftIso } from "./lib";
import { fallback, seeded, sleep, type CollectContext, type CollectResult } from "./support";

export async function mockZscaler(context: CollectContext): Promise<CollectResult> {
  const { incident, entities, audit } = context;
  const random = seeded(`${incident.investigationId}:zscaler`);
  const user = fallback(entities.users, "a.mercer@contoso.com");
  const device = fallback(entities.devices, "wks-fin-0412.contoso.com");
  const badDomain = fallback(entities.domains, "cdn-update-delivery.net");
  const externalIp = fallback(entities.externalIps, "203.0.113.47");
  const start = shiftIso(incident.alertTime, -240);
  const end = shiftIso(incident.alertTime, 240);

  await sleep(random.int(400, 1200));
  audit.log("zscaler_web_insights", `${user},${badDomain}`, "ok", random.int(300, 900));

  const transactions = [
    {
      timestamp: shiftIso(incident.alertTime, -108),
      user,
      device,
      clientIp: fallback(entities.internalIps, "10.14.22.87"),
      serverIp: externalIp,
      host: badDomain,
      url: `https://${badDomain}/secure/invoice-2417.html`,
      urlCategory: "Newly Registered Domains",
      action: "Allowed",
      reason: "No matching policy",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edge/131.0",
      requestSize: 1204,
      responseSize: 48211,
      riskScore: 84,
    },
    {
      timestamp: shiftIso(incident.alertTime, -104),
      user,
      device,
      clientIp: fallback(entities.internalIps, "10.14.22.87"),
      serverIp: externalIp,
      host: badDomain,
      url: `https://${badDomain}/secure/download/invoice_update.exe`,
      urlCategory: "Newly Registered Domains",
      action: "Allowed",
      reason: "File type not inspected",
      fileType: "EXE",
      responseSize: 1284112,
      riskScore: 91,
    },
    {
      timestamp: shiftIso(incident.alertTime, 7),
      user,
      device,
      clientIp: fallback(entities.internalIps, "10.14.22.87"),
      serverIp: externalIp,
      host: badDomain,
      url: `https://${badDomain}/api/beacon`,
      urlCategory: "Command and Control",
      action: "Allowed",
      reason: "Category updated after transaction",
      responseSize: 812,
      riskScore: 96,
    },
    {
      timestamp: shiftIso(incident.alertTime, 63),
      user,
      device,
      clientIp: fallback(entities.internalIps, "10.14.22.87"),
      serverIp: "198.51.100.77",
      host: "paste.example-share.io",
      url: "https://paste.example-share.io/upload",
      urlCategory: "File Host",
      action: "Blocked",
      reason: "DLP dictionary: Finance-PII",
      requestSize: 8412334,
      riskScore: 88,
    },
    {
      timestamp: shiftIso(incident.alertTime, 121),
      user,
      device,
      clientIp: fallback(entities.internalIps, "10.14.22.87"),
      serverIp: "13.107.42.14",
      host: "outlook.office365.com",
      url: "https://outlook.office365.com/owa/",
      urlCategory: "Professional Services",
      action: "Allowed",
      reason: "Allowlisted",
      responseSize: 24122,
      riskScore: 2,
    },
  ];

  const blocked = transactions.filter((t) => t.action === "Blocked").length;
  audit.log("zscaler_transactions_normalized", user, `records=${transactions.length},blocked=${blocked}`, 0);

  return {
    data: {
      window: { start, end },
      user,
      transactions,
      summary: {
        total: transactions.length,
        blocked,
        highestRiskScore: Math.max(...transactions.map((t) => t.riskScore)),
        categories: [...new Set(transactions.map((t) => t.urlCategory))],
      },
    },
    events: [
      {
        ts: transactions[0].timestamp,
        title: `Browsed newly registered domain ${badDomain}`,
        detail: `${user} loaded ${transactions[0].url} — category ${transactions[0].urlCategory}, allowed (${transactions[0].reason})`,
        entity: user,
        severity: "medium",
      },
      {
        ts: transactions[1].timestamp,
        title: "Executable downloaded through the proxy",
        detail: `${transactions[1].url} (1.28 MB EXE) allowed — ${transactions[1].reason}`,
        entity: user,
        severity: "high",
      },
      {
        ts: transactions[2].timestamp,
        title: `Command-and-control callback to ${badDomain}`,
        detail: `${transactions[2].url} classified ${transactions[2].urlCategory} after the fact, risk ${transactions[2].riskScore}`,
        entity: badDomain,
        severity: "high",
      },
      {
        ts: transactions[3].timestamp,
        title: "DLP blocked an 8 MB upload",
        detail: `Upload to ${transactions[3].host} blocked by ${transactions[3].reason}`,
        entity: user,
        severity: "high",
      },
      {
        ts: transactions[4].timestamp,
        title: "Normal mail access resumed",
        detail: "outlook.office365.com session, no policy hit",
        entity: user,
        severity: "informational",
      },
    ],
    recordCount: transactions.length,
  };
}
