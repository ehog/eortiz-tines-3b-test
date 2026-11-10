// Receives a Microsoft Defender alert (Microsoft Graph security alert v2 shape)
// over HTTP. When no alert is posted (e.g. a GET or empty body), a realistic
// synthetic Defender alert is generated so the workflow can be exercised
// without a Defender connector.

const raw = await Bun.stdin.text();

function parseHttpBody(req: string): { method: string; body: string } {
  const sep = req.indexOf("\r\n\r\n");
  const head = sep === -1 ? req : req.slice(0, sep);
  const body = sep === -1 ? "" : req.slice(sep + 4);
  const method = head.split(" ")[0]?.toUpperCase() ?? "";
  return { method, body };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function syntheticAlert(): Record<string, unknown> {
  const now = new Date();
  const first = new Date(now.getTime() - 12 * 60 * 1000);
  const id = `da${crypto.randomUUID().replace(/-/g, "")}`;
  const host = pick(["WS-FIN-0142", "LT-ENG-0377", "SRV-APP-12", "WS-HR-0088"]);
  const user = pick(["jsmith", "mgarcia", "akhan", "lchen"]);
  const scenario = pick([
    {
      title: "Suspicious PowerShell command line",
      category: "Execution",
      severity: "high",
      mitre: ["T1059.001"],
      description:
        "A suspicious PowerShell command line was observed. The command downloaded and executed content from a remote host, which is common in malware staging.",
      process: "powershell.exe",
      cmd: "powershell.exe -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkA",
      sha256: "de96a6e69944335375dc1ac238336066889d9ffc7d73628ef4fe1b1b160ab32c",
    },
    {
      title: "Credential dumping activity detected (LSASS access)",
      category: "CredentialAccess",
      severity: "high",
      mitre: ["T1003.001"],
      description:
        "A process accessed the memory of the Local Security Authority Subsystem Service (LSASS), which may indicate an attempt to dump credentials.",
      process: "rundll32.exe",
      cmd: "rundll32.exe C:\\Windows\\System32\\comsvcs.dll, MiniDump 624 C:\\Temp\\lsass.dmp full",
      sha256: "b5c78bef3883e3099f7ef844da1446db29107e5c0223b97f29e7fafab5527f15",
    },
    {
      title: "Ransomware behavior detected in the file system",
      category: "Impact",
      severity: "medium",
      mitre: ["T1486"],
      description:
        "A process rapidly modified and renamed many files with a new extension, a behavior consistent with ransomware encryption.",
      process: "svch0st.exe",
      cmd: "C:\\Users\\Public\\svch0st.exe --encrypt C:\\Shares",
      sha256: "4c0a1d2e5f6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
    },
  ]);

  return {
    id,
    providerAlertId: id,
    incidentId: String(Math.floor(10000 + Math.random() * 90000)),
    status: "new",
    severity: scenario.severity,
    classification: null,
    determination: null,
    serviceSource: "microsoftDefenderForEndpoint",
    detectionSource: "microsoftDefenderForEndpoint",
    productName: "Microsoft Defender for Endpoint",
    title: scenario.title,
    description: scenario.description,
    category: scenario.category,
    mitreTechniques: scenario.mitre,
    recommendedActions:
      "1. Isolate the device if the activity is confirmed malicious.\n2. Review the process tree and collect an investigation package.\n3. Reset credentials for the affected user.",
    alertWebUrl: `https://security.microsoft.com/alerts/${id}`,
    incidentWebUrl: `https://security.microsoft.com/incidents/${id}`,
    tenantId: "00000000-0000-0000-0000-000000000000",
    createdDateTime: now.toISOString(),
    lastUpdateDateTime: now.toISOString(),
    firstActivityDateTime: first.toISOString(),
    lastActivityDateTime: now.toISOString(),
    evidence: [
      {
        "@odata.type": "#microsoft.graph.security.deviceEvidence",
        verdict: "suspicious",
        deviceDnsName: `${host.toLowerCase()}.contoso.local`,
        osPlatform: "Windows11",
        riskScore: "high",
        mdeDeviceId: crypto.randomUUID().replace(/-/g, ""),
      },
      {
        "@odata.type": "#microsoft.graph.security.userEvidence",
        verdict: "unknown",
        userAccount: { accountName: user, domainName: "CONTOSO", userPrincipalName: `${user}@contoso.com` },
      },
      {
        "@odata.type": "#microsoft.graph.security.processEvidence",
        verdict: "suspicious",
        processCommandLine: scenario.cmd,
        imageFile: { fileName: scenario.process, sha256: scenario.sha256 },
      },
    ],
    synthetic: true,
  };
}

const { method, body } = parseHttpBody(raw);
let alert: Record<string, unknown> | null = null;

if (method === "POST" && body.trim()) {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    console.error(JSON.stringify({ event: "invalid_json_body" }));
    process.exit(1);
  }
  // Accept a bare alert, a { value: [alert] } Graph list, or { alert: {...} }.
  const candidate = Array.isArray(parsed?.value) ? parsed.value[0] : parsed?.alert ?? parsed;
  if (candidate && typeof candidate === "object" && Object.keys(candidate).length > 0) {
    alert = candidate;
  }
}

if (!alert) {
  alert = syntheticAlert();
  console.error(JSON.stringify({ event: "synthetic_alert_generated", id: alert.id }));
} else {
  console.error(JSON.stringify({ event: "alert_received", id: alert.id ?? null }));
}

console.log(JSON.stringify(alert));
