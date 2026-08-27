import { intBetween, offsetIso, pick } from "./lib";
import { runSearch } from "./search";

const DEVICES = [
  { name: "FIN-WKS-0142", os: "Windows 11 23H2", riskLevel: "High", ip: "10.14.22.87" },
  { name: "HR-LAP-0918", os: "Windows 11 22H2", riskLevel: "Medium", ip: "10.14.31.44" },
  { name: "ENG-MBP-0231", os: "macOS 14.5", riskLevel: "Medium", ip: "10.22.8.19" },
  { name: "OPS-SRV-DB03", os: "Windows Server 2022", riskLevel: "High", ip: "10.40.2.11" },
  { name: "SALES-WKS-0507", os: "Windows 10 22H2", riskLevel: "Low", ip: "10.18.5.63" },
];

const USERS = [
  { upn: "j.mercer@corp.example.com", department: "Finance", title: "AP Specialist" },
  { upn: "d.okafor@corp.example.com", department: "Human Resources", title: "Recruiter" },
  { upn: "s.raymond@corp.example.com", department: "Engineering", title: "SRE" },
  { upn: "svc-backup@corp.example.com", department: "IT Operations", title: "Service account" },
];

const ALERTS = [
  { title: "Suspicious connection to known malicious infrastructure", severity: "High", category: "CommandAndControl" },
  { title: "Malicious file detected by cloud protection", severity: "High", category: "Malware" },
  { title: "Anomalous outbound data transfer", severity: "Medium", category: "Exfiltration" },
  { title: "Process launched from suspicious download", severity: "Medium", category: "Execution" },
];

await runSearch("defender", 400, ({ indicator, type, baseIso, next }) => {
  const deviceCount = intBetween(next, 1, 3);
  const devices = Array.from({ length: deviceCount }, (_, i) => {
    const d = DEVICES[(intBetween(next, 0, DEVICES.length - 1) + i) % DEVICES.length]!;
    return {
      deviceName: d.name,
      deviceId: `dev-${(Math.floor(next() * 0xfffffff) + 0x1000000).toString(16)}`,
      osPlatform: d.os,
      riskScore: d.riskLevel,
      lastInternalIp: d.ip,
      lastSeen: offsetIso(baseIso, intBetween(next, 5, 600)),
    };
  });

  const users = Array.from({ length: intBetween(next, 1, 2) }, (_, i) => {
    const u = USERS[(intBetween(next, 0, USERS.length - 1) + i) % USERS.length]!;
    return { accountUpn: u.upn, department: u.department, title: u.title };
  });

  const connectionCount = intBetween(next, 2, 6);
  const connections = Array.from({ length: connectionCount }, (_, i) => ({
    timestamp: offsetIso(baseIso, intBetween(next, 10, 4320) + i),
    deviceName: devices[i % devices.length]!.deviceName,
    initiatingProcess: pick(next, ["powershell.exe", "chrome.exe", "svchost.exe", "rundll32.exe", "curl.exe"]),
    remoteTarget: type === "sha1" || type === "sha256" ? "n/a (file indicator)" : indicator,
    remotePort: pick(next, [443, 80, 8443, 53, 4444]),
    protocol: pick(next, ["Tcp", "Tcp", "Udp"]),
    action: pick(next, ["ConnectionSuccess", "ConnectionSuccess", "ConnectionFailed", "ConnectionBlocked"]),
  }));

  const alerts = Array.from({ length: intBetween(next, 0, 2) }, (_, i) => {
    const a = ALERTS[(intBetween(next, 0, ALERTS.length - 1) + i) % ALERTS.length]!;
    return {
      alertId: `da_${(Math.floor(next() * 0xffffffff) + 0x10000000).toString(16)}`,
      title: a.title,
      severity: a.severity,
      category: a.category,
      detectedAt: offsetIso(baseIso, intBetween(next, 15, 2880)),
    };
  });

  const fileEvents =
    type === "sha1" || type === "sha256"
      ? Array.from({ length: intBetween(next, 1, 3) }, (_, i) => ({
          timestamp: offsetIso(baseIso, intBetween(next, 20, 3000) + i),
          deviceName: devices[i % devices.length]!.deviceName,
          fileName: pick(next, ["invoice_apr.pdf.exe", "update_helper.dll", "setup_x64.msi", "payload.tmp"]),
          folderPath: pick(next, ["C:\\Users\\Public\\Downloads", "C:\\ProgramData\\Temp", "/tmp"]),
          actionType: pick(next, ["FileCreated", "ProcessCreated", "FileModified"]),
        }))
      : [];

  const stamps = [
    ...connections.map((c) => c.timestamp),
    ...fileEvents.map((f) => f.timestamp),
    ...devices.map((d) => d.lastSeen),
  ].sort();

  return {
    findings: {
      table: type === "sha1" || type === "sha256" ? "DeviceFileEvents" : "DeviceNetworkEvents",
      tenant: "corp.example.com",
      devices,
      users,
      networkConnections: connections,
      fileEvents,
      alerts,
    },
    frequency: connections.length + fileEvents.length,
    firstSeen: stamps[0]!,
    lastSeen: stamps[stamps.length - 1]!,
  };
});
