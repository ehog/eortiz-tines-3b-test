import { normalizeAlert, slug, type Alert } from "./soclib";

/** Overnight backlog used by the demo reset so the digest and queue have content on the first run. */
export function backlogAlerts(now: Date): Alert[] {
  const specs = [
    { h: 11.5, source: "sentinel", id: "INC-55102", title: "Impossible travel sign-in for sam.oyelaran", severity: "high", confidence: "high", user: "sam.oyelaran", hostname: "hr-files-04", indicator: "102.89.44.17", businessImpact: "customer_data" },
    { h: 10.2, source: "defender", id: "da-88190", title: "Credential dumping attempt against LSASS", severity: "high", confidence: "high", user: "marc.duval", hostname: "dc-core-01", indicator: "procdump64.exe", businessImpact: "internal_only" },
    { h: 9.6, source: "zscaler", id: "zs-771455", title: "Cryptomining traffic detected", severity: "medium", confidence: "high", user: "tom.becker", hostname: "build-agent-11", indicator: "pool.miner.example", businessImpact: "none" },
    { h: 8.9, source: "proofpoint", id: "pp-4310", title: "Credential phishing message delivered then retracted", severity: "high", confidence: "confirmed", user: "priya.nair", indicator: "sso-verify.example/login", businessImpact: "internal_only" },
    { h: 8.1, source: "servicenow", id: "INC0092488", title: "Suspicious invoice email reported by finance", severity: "medium", confidence: "high", user: "lena.fischer", hostname: "lap-lf-2291", businessImpact: "revenue_impacting" },
    { h: 7.4, source: "sentinel", id: "INC-55118", title: "Anomalous mailbox rule creation", severity: "medium", confidence: "medium", user: "priya.nair", hostname: "lap-td-8830", businessImpact: "internal_only" },
    { h: 6.6, source: "zscaler", id: "zs-771502", title: "Policy violation: streaming category", severity: "low", confidence: "low", user: "tom.becker", hostname: "kiosk-lobby-07", indicator: "stream-hub.example", businessImpact: "none" },
    { h: 5.8, source: "defender", id: "da-88212", title: "Potentially unwanted application blocked", severity: "low", confidence: "medium", user: "sam.oyelaran", hostname: "lap-td-8830", businessImpact: "none" },
    { h: 4.9, source: "proofpoint", id: "pp-4344", title: "Bulk marketing mail quarantined", severity: "low", confidence: "low", user: "dana.reyes", indicator: "promos@mail-blast.example", businessImpact: "none" },
    { h: 3.7, source: "sentinel", id: "INC-55131", title: "Mass download from SharePoint by single account", severity: "high", confidence: "high", user: "dana.reyes", hostname: "hr-files-04", indicator: "203.0.113.42", businessImpact: "customer_data" },
    { h: 2.5, source: "zscaler", id: "zs-771588", title: "Large upload to unsanctioned file sharing site", severity: "high", confidence: "medium", user: "dana.reyes", hostname: "hr-files-04", indicator: "files-drop.example", businessImpact: "customer_data" },
    { h: 1.4, source: "defender", id: "da-88240", title: "Suspicious scheduled task registration", severity: "medium", confidence: "medium", user: "svc_backup", hostname: "vpn-gw-01", indicator: "schtasks.exe /create", businessImpact: "internal_only" },
  ];

  return specs.map((spec) => {
    const at = new Date(now.getTime() - spec.h * 3600_000).toISOString();
    const { h, ...record } = spec;
    return normalizeAlert(record, at, slug(String(record.id)));
  });
}
