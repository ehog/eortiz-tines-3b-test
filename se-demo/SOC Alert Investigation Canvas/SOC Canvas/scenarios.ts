export interface Scenario {
  key: string;
  name: string;
  shape: "Microsoft Defender (Graph security alert)" | "Microsoft Sentinel (incident webhook)";
  blurb: string;
  entities: string[];
  build: (now: Date) => Record<string, unknown>;
}

function iso(now: Date, minutesAgo: number): string {
  return new Date(now.getTime() - minutesAgo * 60_000).toISOString();
}

export const SCENARIOS: Scenario[] = [
  {
    key: "endpoint-malware",
    name: "Malware on a finance endpoint",
    shape: "Microsoft Defender (Graph security alert)",
    blurb:
      "Multi-stage Defender incident: mail-delivered loader executes, spawns encoded PowerShell, beacons out to a newly registered domain.",
    entities: ["wks-fin-0412.contoso.com", "a.mercer@contoso.com", "203.0.113.47", "cdn-update-delivery.net", "invoice_update.exe"],
    build: (now) => ({
      incidentId: 48211,
      displayName: "Multi-stage incident involving Execution & Command and control on one endpoint",
      severity: "high",
      status: "active",
      classification: "unknown",
      createdDateTime: iso(now, 42),
      lastUpdateDateTime: iso(now, 6),
      tenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
      alerts: [
        {
          id: "da637-1a2b3c",
          title: "Suspicious PowerShell command line",
          description:
            "A PowerShell process launched with an encoded command shortly after a file was downloaded and executed from the user's Downloads folder.",
          severity: "high",
          status: "new",
          category: "Execution",
          detectionSource: "microsoftDefenderForEndpoint",
          mitreTechniques: ["T1059.001", "T1204.002", "T1053.005"],
          firstActivityDateTime: iso(now, 40),
          createdDateTime: iso(now, 39),
          evidence: [
            {
              "@odata.type": "#microsoft.graph.security.deviceEvidence",
              deviceDnsName: "wks-fin-0412.contoso.com",
              rbacGroupName: "Finance",
              healthStatus: "active",
              riskScore: "high",
              ipInterfaces: ["10.14.22.87", "169.254.14.2"],
              loggedOnUsers: [{ accountName: "a.mercer", domainName: "contoso.com" }],
            },
            {
              "@odata.type": "#microsoft.graph.security.processEvidence",
              processId: 7412,
              parentProcessId: 4120,
              processCommandLine: "powershell.exe -nop -w hidden -enc SQBFAFgAKABOAGUAdwAtAE8AYgBqAGUAYwB0",
              imageFile: { fileName: "powershell.exe", filePath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0" },
            },
            {
              "@odata.type": "#microsoft.graph.security.fileEvidence",
              fileDetails: {
                fileName: "invoice_update.exe",
                filePath: "C:\\Users\\a.mercer\\Downloads",
                sha256: "9f2c3e6a4bd8177f4b2c0aa5d7311e8ce2a4f6b9c0d1e2f3a4b5c6d7e8f90112",
                signer: null,
              },
            },
            {
              "@odata.type": "#microsoft.graph.security.ipEvidence",
              ipAddress: "203.0.113.47",
              countryLetterCode: "NL",
            },
            {
              "@odata.type": "#microsoft.graph.security.urlEvidence",
              url: "https://cdn-update-delivery.net/secure/download/invoice_update.exe",
            },
          ],
        },
      ],
    }),
  },
  {
    key: "phishing-signin",
    name: "Phishing to suspicious sign-in",
    shape: "Microsoft Sentinel (incident webhook)",
    blurb:
      "Sentinel incident correlating a Proofpoint-delivered phishing cluster with an impossible-travel sign-in and a new inbox rule.",
    entities: ["a.mercer@contoso.com", "45.133.1.208", "invoice-portal-services.com", "wks-fin-0412.contoso.com"],
    build: (now) => ({
      id: "/subscriptions/8c1f2ab5/resourceGroups/soc/providers/Microsoft.SecurityInsights/incidents/9a41",
      name: "9a41c5f0-1d2e-4b77-8a30-6f7c1b2d3e4f",
      type: "Microsoft.SecurityInsights/Incidents",
      properties: {
        incidentNumber: 5182,
        title: "Impossible travel sign-in following credential phishing",
        description:
          "A user signed in from a new country 23 hours after receiving a credential-harvesting message, then created a mailbox rule hiding invoice replies.",
        severity: "High",
        status: "New",
        classification: null,
        providerName: "Azure Sentinel",
        createdTimeUtc: iso(now, 55),
        firstActivityTimeUtc: iso(now, 1385),
        lastActivityTimeUtc: iso(now, 20),
        incidentUrl: "https://portal.azure.com/#blade/Microsoft_Azure_Security_Insights/Incident/9a41",
        relatedAnalyticRuleIds: ["Impossible travel", "Mailbox rule hiding messages"],
        labels: [{ labelName: "BEC", labelType: "User" }],
        entities: [
          {
            kind: "Account",
            properties: { userPrincipalName: "a.mercer@contoso.com", accountName: "a.mercer", upnSuffix: "contoso.com" },
          },
          { kind: "Ip", properties: { address: "45.133.1.208", location: { countryName: "Nigeria", city: "Lagos" } } },
          { kind: "Ip", properties: { address: "10.14.22.87" } },
          { kind: "Host", properties: { hostName: "wks-fin-0412", dnsDomain: "contoso.com" } },
          { kind: "Url", properties: { url: "https://invoice-portal-services.com/o365/login?id=am9" } },
          { kind: "MailMessage", properties: { recipientEmailAddress: "a.mercer@contoso.com", p1Sender: "billing@invoice-portal-services.com" } },
        ],
      },
    }),
  },
  {
    key: "proxy-exfil",
    name: "Data exfiltration through the proxy",
    shape: "Microsoft Sentinel (incident webhook)",
    blurb:
      "Sentinel incident on an unusual 8 MB upload to a file-sharing host from a finance workstation, with DLP hits on the same session.",
    entities: ["j.okafor@contoso.com", "wks-fin-0388.contoso.com", "198.51.100.77", "paste.example-share.io"],
    build: (now) => ({
      id: "/subscriptions/8c1f2ab5/resourceGroups/soc/providers/Microsoft.SecurityInsights/incidents/7b12",
      name: "7b12d904-88aa-4c1e-9a55-2f3e4d5c6b7a",
      type: "Microsoft.SecurityInsights/Incidents",
      properties: {
        incidentNumber: 5190,
        title: "Unusual volume of data uploaded to an external file host",
        description:
          "A finance workstation uploaded 8.4 MB to paste.example-share.io in a single session; DLP matched the Finance-PII dictionary.",
        severity: "Medium",
        status: "New",
        providerName: "Azure Sentinel",
        createdTimeUtc: iso(now, 33),
        firstActivityTimeUtc: iso(now, 95),
        lastActivityTimeUtc: iso(now, 12),
        incidentUrl: "https://portal.azure.com/#blade/Microsoft_Azure_Security_Insights/Incident/7b12",
        relatedAnalyticRuleIds: ["Data exfiltration to external storage", "DLP policy match"],
        entities: [
          { kind: "Account", properties: { userPrincipalName: "j.okafor@contoso.com", accountName: "j.okafor", upnSuffix: "contoso.com" } },
          { kind: "Host", properties: { hostName: "wks-fin-0388", dnsDomain: "contoso.com" } },
          { kind: "Ip", properties: { address: "198.51.100.77" } },
          { kind: "Ip", properties: { address: "10.14.22.91" } },
          { kind: "Url", properties: { url: "https://paste.example-share.io/upload" } },
          { kind: "File", properties: { fileName: "Q3_reconciliation_export.csv", sha256: "31a9d2f77c0bb4e6a5188c3d4e5f60718293a4b5c6d7e8f9012345678abcdef1" } },
        ],
      },
    }),
  },
];
