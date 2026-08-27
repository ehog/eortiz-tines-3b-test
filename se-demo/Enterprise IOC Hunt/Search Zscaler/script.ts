import { intBetween, offsetIso, pick } from "./lib";
import { runSearch } from "./search";

const USERS = [
  { user: "j.mercer@corp.example.com", location: "Phoenix HQ", device: "FIN-WKS-0142" },
  { user: "d.okafor@corp.example.com", location: "Remote - ZCC", device: "HR-LAP-0918" },
  { user: "s.raymond@corp.example.com", location: "Austin Office", device: "ENG-MBP-0231" },
  { user: "contractor.vp@corp.example.com", location: "Remote - ZCC", device: "CTR-WKS-0044" },
];

const CATEGORIES = ["Newly Registered Domains", "Miscellaneous or Unknown", "Malware Sites", "Web Hosting", "Professional Services"];

await runSearch("zscaler", 1900, ({ indicator, type, baseIso, next }) => {
  const count = intBetween(next, 2, 8);
  const transactions = Array.from({ length: count }, (_, i) => {
    const u = USERS[(intBetween(next, 0, USERS.length - 1) + i) % USERS.length]!;
    const action = pick(next, ["Allowed", "Allowed", "Blocked", "Cautioned"]);
    return {
      timestamp: offsetIso(baseIso, intBetween(next, 15, 8640) + i),
      user: u.user,
      device: u.device,
      location: u.location,
      url:
        type === "url"
          ? indicator
          : type === "domain"
            ? `https://${indicator}/${pick(next, ["", "login", "update.php", "files/download"])}`
            : type === "sha1" || type === "sha256"
              ? `https://cdn-files-delivery.net/dl/${indicator.slice(0, 12)}/${pick(next, ["setup_x64.msi", "update_helper.dll", "invoice_apr.pdf.exe"])}`
              : `https://${indicator}`,
      serverIp: type === "ipv4" ? indicator : `${intBetween(next, 45, 209)}.${intBetween(next, 1, 254)}.${intBetween(next, 1, 254)}.${intBetween(next, 1, 254)}`,
      action,
      urlCategory: pick(next, CATEGORIES),
      threatName: action === "Blocked" ? pick(next, ["Malurl.Phish", "Trojan.GenericKD", "Suspicious.Domain"]) : "None",
      requestMethod: pick(next, ["GET", "GET", "POST"]),
      bytesOut: intBetween(next, 400, 90000),
      bytesIn: intBetween(next, 800, 450000),
      userAgent: pick(next, ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0", "curl/8.4.0", "python-requests/2.31.0"]),
    };
  });

  const users = [...new Set(transactions.map((t) => t.user))].map((user) => ({
    user,
    transactions: transactions.filter((t) => t.user === user).length,
    department: pick(next, ["Finance", "Human Resources", "Engineering", "Contractors"]),
  }));

  const stamps = transactions.map((t) => t.timestamp).sort();

  return {
    findings: {
      cloud: "zscalertwo.net",
      transactions,
      users,
      allowed: transactions.filter((t) => t.action === "Allowed").length,
      blocked: transactions.filter((t) => t.action === "Blocked").length,
      totalBytes: transactions.reduce((sum, t) => sum + t.bytesIn + t.bytesOut, 0),
      urlCategories: [...new Set(transactions.map((t) => t.urlCategory))],
    },
    frequency: transactions.length,
    firstSeen: stamps[0]!,
    lastSeen: stamps[stamps.length - 1]!,
  };
});
