import { shiftIso } from "./lib";
import { buildQueries } from "./client";
import { fallback, seeded, sleep, type CollectContext, type CollectResult } from "./support";

const GEOS = ["Phoenix, US", "Dublin, IE", "Lagos, NG", "Frankfurt, DE", "Ho Chi Minh City, VN"];

export async function mockSentinel(context: CollectContext): Promise<CollectResult> {
  const { incident, entities, audit } = context;
  const random = seeded(`${incident.investigationId}:sentinel`);
  const user = fallback(entities.users, "a.mercer@contoso.com");
  const device = fallback(entities.devices, "wks-fin-0412.contoso.com");
  const externalIp = fallback(entities.externalIps, "203.0.113.47");
  const timespan = `${shiftIso(incident.alertTime, -1440)}/${shiftIso(incident.alertTime, 240)}`;
  const queries = buildQueries(context);
  const executed: Record<string, unknown>[] = [];
  const events: CollectResult["events"] = [];

  await sleep(random.int(700, 1900));

  for (const item of queries.length ? queries : [{ entity: user, kind: "account", query: "SigninLogs | take 100" }]) {
    const started = Date.now();
    const rows = rowsFor(item.kind, item.entity, incident.alertTime, random, { user, device, externalIp });
    audit.log("sentinel_query", item.entity, `rows=${rows.length}`, Date.now() - started + random.int(120, 700));
    executed.push({
      entity: item.entity,
      kind: item.kind,
      table: tableFor(item.kind),
      query: item.query,
      rowCount: rows.length,
      rows,
    });
  }

  const suspiciousIp = "45.133.1.208";
  events.push(
    {
      ts: shiftIso(incident.alertTime, -1380),
      title: "Successful sign-in from a new country",
      detail: `${user} signed in to Office365 Exchange Online from ${suspiciousIp} (Lagos, NG) — MFA satisfied by push`,
      entity: user,
      severity: "high",
    },
    {
      ts: shiftIso(incident.alertTime, -1350),
      title: "Inbox rule created",
      detail: `New-InboxRule "RSS Feeds" moving messages containing "invoice" to RSS Subscriptions, actor ${user}`,
      entity: user,
      severity: "high",
    },
    {
      ts: shiftIso(incident.alertTime, -140),
      title: "Sign-in from corporate range",
      detail: `${user} signed in from ${fallback(entities.internalIps, "10.14.22.87")} on ${device} — normal pattern`,
      entity: user,
      severity: "informational",
    },
    {
      ts: shiftIso(incident.alertTime, 8),
      title: "Firewall allowed egress to alert destination",
      detail: `CommonSecurityLog: PAN-OS allowed ${fallback(entities.internalIps, "10.14.22.87")} → ${externalIp}:443`,
      entity: externalIp,
      severity: "medium",
    },
    {
      ts: shiftIso(incident.alertTime, 41),
      title: "Second host contacted the same destination",
      detail: `wks-fin-0388.contoso.com → ${externalIp}:443, 6 sessions in 4 minutes`,
      entity: externalIp,
      severity: "high",
    },
    {
      ts: shiftIso(incident.alertTime, 95),
      title: "Analytic rule correlated related incident",
      detail: `Sentinel rule "Suspicious PowerShell after mail delivery" also fired for ${device}`,
      entity: device,
      severity: "medium",
    },
  );

  return {
    data: { timespan, workspace: "sentinel-prod-eastus", queries: executed, correlatedRules: ["Suspicious PowerShell after mail delivery", "Impossible travel"] },
    events,
    recordCount: executed.reduce((total, item) => total + Number(item.rowCount ?? 0), 0),
  };
}

function tableFor(kind: string): string {
  if (kind === "account") return "SigninLogs";
  if (kind === "host") return "SecurityEvent";
  return "CommonSecurityLog";
}

function rowsFor(
  kind: string,
  entity: string,
  alertTime: string,
  random: ReturnType<typeof seeded>,
  actors: { user: string; device: string; externalIp: string },
): Record<string, unknown>[] {
  const count = random.int(3, 7);
  return Array.from({ length: count }, (_, index) => {
    const ts = shiftIso(alertTime, random.int(-1440, 120));
    if (kind === "account") {
      return {
        TimeGenerated: ts,
        UserPrincipalName: entity,
        AppDisplayName: random.pick(["Office365 Exchange Online", "Microsoft Teams", "Azure Portal", "OneDrive"]),
        IPAddress: index === 0 ? "45.133.1.208" : actors.externalIp,
        Location: random.pick(GEOS),
        ResultType: index === 0 ? "0" : random.pick(["0", "50126", "50074"]),
        ResultDescription: index === 0 ? "Success" : random.pick(["Success", "Invalid username or password", "Strong auth required"]),
      };
    }
    if (kind === "host") {
      return {
        TimeGenerated: ts,
        Computer: entity,
        Account: `CONTOSO\\${actors.user.split("@")[0]}`,
        EventID: random.pick([4624, 4688, 4698, 5145]),
        Activity: random.pick([
          "4624 - An account was successfully logged on",
          "4688 - A new process has been created",
          "4698 - A scheduled task was created",
          "5145 - A network share object was checked",
        ]),
      };
    }
    return {
      TimeGenerated: ts,
      DeviceVendor: "Palo Alto Networks",
      SourceIP: "10.14.22.87",
      DestinationIP: entity,
      DestinationPort: random.pick([443, 8443, 53]),
      Activity: random.pick(["allow", "allow", "deny"]),
      SentBytes: random.int(1200, 480000),
    };
  }).sort((a, b) => String(a.TimeGenerated).localeCompare(String(b.TimeGenerated)));
}
