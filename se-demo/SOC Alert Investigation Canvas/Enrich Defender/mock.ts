import { shiftIso } from "./lib";
import { fallback, seeded, sleep, type CollectContext, type CollectResult } from "./support";

export async function mockDefender(context: CollectContext): Promise<CollectResult> {
  const { incident, entities, audit } = context;
  const random = seeded(`${incident.investigationId}:defender`);
  const device = fallback(entities.devices, "wks-fin-0412.contoso.com");
  const user = fallback(entities.users, "a.mercer@contoso.com");
  const externalIp = fallback(entities.externalIps, "203.0.113.47");
  const hash = fallback(entities.hashes, "9f2c3e6a4bd8177f4b2c0aa5d7311e8ce2a4f6b9c0d1e2f3a4b5c6d7e8f90112");
  const process = fallback(entities.processes, "invoice_update.exe");
  const windowStart = shiftIso(incident.alertTime, -120);
  const windowEnd = shiftIso(incident.alertTime, 120);

  await sleep(random.int(500, 1400));
  audit.log("defender_machine_lookup", device, "ok", random.int(180, 520));

  const machine = {
    id: `mde-${random.int(100000, 999999)}`,
    computerDnsName: device,
    osPlatform: "Windows11",
    osBuild: 26100,
    version: "24H2",
    healthStatus: "Active",
    onboardingStatus: "Onboarded",
    isolationStatus: "NotIsolated",
    riskScore: random.pick(["Medium", "High"]),
    exposureLevel: random.pick(["Medium", "High"]),
    lastIpAddress: fallback(entities.internalIps, "10.14.22.87"),
    lastExternalIpAddress: externalIp,
    lastSeen: shiftIso(incident.alertTime, random.int(1, 25)),
    machineTags: ["Finance", "Standard build"],
    loggedOnUsers: [
      { accountName: user.split("@")[0], domainName: "CONTOSO", logonTypes: "Interactive", isDomainAdmin: false },
      { accountName: "svc-backup", domainName: "CONTOSO", logonTypes: "Network", isDomainAdmin: false },
    ],
  };

  audit.log("defender_advanced_hunting", `DeviceProcessEvents:${device}`, "ok", random.int(600, 1500));

  const processTree = {
    ts: incident.alertTime,
    process: "outlook.exe",
    pid: random.int(2000, 6000),
    account: user,
    commandLine: '"C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE"',
    children: [
      {
        ts: shiftIso(incident.alertTime, 1),
        process,
        pid: random.int(6000, 9000),
        account: user,
        commandLine: `C:\\Users\\${user.split("@")[0]}\\Downloads\\${process}`,
        sha256: hash,
        signer: "unsigned",
        children: [
          {
            ts: shiftIso(incident.alertTime, 2),
            process: "powershell.exe",
            pid: random.int(9000, 12000),
            account: user,
            commandLine:
              "powershell.exe -nop -w hidden -enc SQBFAFgAKABOAGUAdwAtAE8AYgBqAGUAYwB0ACAATgBlAHQAL",
            children: [
              {
                ts: shiftIso(incident.alertTime, 4),
                process: "rundll32.exe",
                pid: random.int(12000, 15000),
                account: user,
                commandLine: "rundll32.exe C:\\Windows\\Temp\\upd.dll,Start",
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };

  const activity = [
    {
      timestamp: shiftIso(incident.alertTime, -96),
      actionType: "FileCreated",
      fileName: process,
      folderPath: `C:\\Users\\${user.split("@")[0]}\\Downloads`,
      sha256: hash,
      initiatingProcess: "msedge.exe",
    },
    {
      timestamp: shiftIso(incident.alertTime, -3),
      actionType: "ProcessCreated",
      fileName: process,
      commandLine: `C:\\Users\\${user.split("@")[0]}\\Downloads\\${process}`,
      initiatingProcess: "outlook.exe",
    },
    {
      timestamp: shiftIso(incident.alertTime, 2),
      actionType: "PowerShellCommand",
      fileName: "powershell.exe",
      commandLine: "-nop -w hidden -enc <base64>",
      initiatingProcess: process,
    },
    {
      timestamp: shiftIso(incident.alertTime, 6),
      actionType: "ConnectionSuccess",
      remoteIP: externalIp,
      remotePort: 443,
      remoteUrl: fallback(entities.domains, "cdn-update-delivery.net"),
      initiatingProcess: "rundll32.exe",
    },
    {
      timestamp: shiftIso(incident.alertTime, 11),
      actionType: "ScheduledTaskCreated",
      taskName: "MicrosoftEdgeUpdateTaskUserCore",
      initiatingProcess: "powershell.exe",
    },
    {
      timestamp: shiftIso(incident.alertTime, 34),
      actionType: "AntivirusDetection",
      threatName: "Trojan:Win32/Basta.A!ml",
      remediationAction: "Quarantined",
      fileName: process,
    },
    {
      timestamp: shiftIso(incident.alertTime, 78),
      actionType: "LogonSuccess",
      accountName: "svc-backup",
      logonType: "Network",
      remoteIP: fallback(entities.internalIps, "10.14.22.91"),
    },
  ];

  const events = [
    {
      ts: activity[0].timestamp,
      title: `File written: ${process}`,
      detail: `${activity[0].folderPath}\\${process} (SHA256 ${hash.slice(0, 16)}…) created by msedge.exe`,
      entity: device,
      severity: "low",
    },
    {
      ts: activity[1].timestamp,
      title: `Process launched from Outlook: ${process}`,
      detail: `${activity[1].commandLine} — parent outlook.exe, user ${user}`,
      entity: device,
      severity: "medium",
    },
    {
      ts: activity[2].timestamp,
      title: "Encoded PowerShell executed",
      detail: "powershell.exe -nop -w hidden -enc <base64> spawned by the downloaded binary",
      entity: device,
      severity: "high",
    },
    {
      ts: activity[3].timestamp,
      title: `Outbound connection to ${externalIp}:443`,
      detail: `rundll32.exe connected to ${activity[3].remoteUrl} (${externalIp})`,
      entity: device,
      severity: "high",
    },
    {
      ts: activity[4].timestamp,
      title: "Persistence: scheduled task created",
      detail: `Task ${activity[4].taskName} registered by powershell.exe`,
      entity: device,
      severity: "high",
    },
    {
      ts: activity[5].timestamp,
      title: "Defender AV quarantined the binary",
      detail: `${activity[5].threatName} — remediation ${activity[5].remediationAction}`,
      entity: device,
      severity: "medium",
    },
    {
      ts: activity[6].timestamp,
      title: "Service account network logon",
      detail: `svc-backup logged on from ${activity[6].remoteIP} within the alert window`,
      entity: device,
      severity: "informational",
    },
  ];

  audit.log("defender_events_normalized", device, `count=${events.length}`, 0);

  return {
    data: {
      window: { start: windowStart, end: windowEnd },
      machines: [machine],
      loggedOnUsers: machine.loggedOnUsers,
      processTree,
      endpointActivity: activity,
      isolationStatus: machine.isolationStatus,
    },
    events,
    recordCount: activity.length + 1,
  };
}
