import { dir, shiftIso } from "./lib";
import { MAX_SCREENSHOTS } from "./client";
import { fallback, seeded, sleep, type CollectContext, type CollectResult } from "./support";

const SUBJECTS = [
  "Invoice 2417 is overdue - action required",
  "RE: Q3 vendor payment confirmation",
  "Your Microsoft 365 password expires today",
  "Payroll adjustment - review before Friday",
  "Shared document: Finance_Reconciliation.xlsx",
  "Urgent: wire instructions updated",
  "Voicemail transcription from +1 (602) 555-0148",
  "DocuSign: please sign Vendor_Agreement_2417",
];

const SENDERS = [
  "billing@invoice-portal-services.com",
  "no-reply@ms-security-alerts.net",
  "ap.department@contoso-vendors.com",
  "notifications@docusign-secure.co",
  "helpdesk@contoso-it-support.net",
];

export async function mockProofpoint(context: CollectContext): Promise<CollectResult> {
  const { incident, entities, audit } = context;
  const random = seeded(`${incident.investigationId}:proofpoint`);
  const user = fallback(entities.users, "a.mercer@contoso.com");
  const badDomain = fallback(entities.domains, "cdn-update-delivery.net");
  const hash = fallback(entities.hashes, "9f2c3e6a4bd8177f4b2c0aa5d7311e8ce2a4f6b9c0d1e2f3a4b5c6d7e8f90112");

  await sleep(random.int(900, 2300));
  audit.log("proofpoint_siem_query", user, "ok", random.int(400, 1100));

  const messageCount = random.int(28, MAX_SCREENSHOTS);
  const messages = Array.from({ length: messageCount }, (_, index) => {
    const sender = index === 0 ? SENDERS[0] : random.pick(SENDERS);
    const delivered = random.next() > 0.35;
    const clicked = index === 0 || random.next() > 0.85;
    return {
      guid: `pp-${incident.investigationId.slice(-6)}-${String(index).padStart(3, "0")}`,
      messageTime: shiftIso(incident.alertTime, -random.int(30, 2880)),
      sender,
      senderIp: `185.${random.int(10, 250)}.${random.int(1, 250)}.${random.int(1, 250)}`,
      recipient: [user],
      subject: index === 0 ? SUBJECTS[0] : random.pick(SUBJECTS),
      quarantined: !delivered,
      disposition: delivered ? "delivered" : "blocked",
      threatType: random.pick(["url", "attachment", "url", "impostor"]),
      threatStatus: random.pick(["active", "active", "cleared"]),
      spamScore: random.int(12, 98),
      phishScore: random.int(30, 100),
      malwareScore: random.int(0, 100),
      attachments: index % 4 === 0 ? [{ name: "invoice_update.zip", sha256: hash, malwareVerdict: "malicious" }] : [],
      urls: [`https://${badDomain}/secure/invoice-${2400 + index}.html`],
      clicked,
      clickTime: clicked ? shiftIso(incident.alertTime, -random.int(20, 200)) : null,
      clickVerdict: clicked ? random.pick(["permitted", "permitted", "blocked"]) : null,
    };
  }).sort((a, b) => a.messageTime.localeCompare(b.messageTime));

  const screenshotDir = `${dir(incident.investigationId)}/screenshots`;
  const screenshots: Record<string, unknown>[] = [];
  for (const [index, message] of messages.slice(0, MAX_SCREENSHOTS).entries()) {
    const file = `${String(index).padStart(3, "0")}.svg`;
    await Bun.write(`${screenshotDir}/${file}`, renderScreenshot(message, index));
    screenshots.push({
      index,
      file,
      contentType: "image/svg+xml",
      messageGuid: message.guid,
      label: message.subject,
      capturedAt: message.messageTime,
      verdict: message.disposition,
    });
  }
  audit.log("proofpoint_screenshots", user, `count=${screenshots.length}`, random.int(600, 1800));

  const clicked = messages.filter((m) => m.clicked);
  const events: CollectResult["events"] = [
    {
      ts: messages[0].messageTime,
      title: `Phishing campaign starts: "${messages[0].subject}"`,
      detail: `First message in the cluster from ${messages[0].sender} to ${user} (${messages[0].disposition})`,
      entity: user,
      severity: "medium",
    },
  ];
  for (const message of clicked.slice(0, 4)) {
    events.push({
      ts: String(message.clickTime ?? message.messageTime),
      title: `URL click ${message.clickVerdict} for ${user}`,
      detail: `${message.urls[0]} clicked from "${message.subject}" (phish score ${message.phishScore})`,
      entity: user,
      severity: message.clickVerdict === "permitted" ? "high" : "low",
    });
  }
  const withAttachment = messages.find((m) => m.attachments.length > 0);
  if (withAttachment) {
    events.push({
      ts: withAttachment.messageTime,
      title: "Malicious attachment delivered",
      detail: `${withAttachment.attachments[0].name} (SHA256 ${hash.slice(0, 16)}…) verdict ${withAttachment.attachments[0].malwareVerdict}`,
      entity: user,
      severity: "high",
    });
  }
  events.push({
    ts: shiftIso(incident.alertTime, 30),
    title: `${messages.filter((m) => m.quarantined).length} related messages quarantined`,
    detail: `Proofpoint retro-quarantined messages from ${[...new Set(messages.map((m) => m.sender))].length} sender addresses in this cluster`,
    entity: user,
    severity: "informational",
  });

  return {
    data: {
      user,
      messageCount: messages.length,
      clickedCount: clicked.length,
      quarantinedCount: messages.filter((m) => m.quarantined).length,
      messages,
      screenshots,
      screenshotCount: screenshots.length,
    },
    events,
    recordCount: messages.length + screenshots.length,
  };
}

/** Mock forensic captures are drawn as SVG so the gallery has real, distinct images to show. */
function renderScreenshot(message: Record<string, unknown>, index: number): string {
  const escape = (value: unknown) =>
    String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const banner = message.quarantined ? "#b91c1c" : "#a16207";
  const bannerText = message.quarantined ? "QUARANTINED BY PROOFPOINT" : "EXTERNAL SENDER — CAUTION";
  const bodyLines = [
    "Dear Accounts Payable,",
    "",
    `Attached is the outstanding statement referenced in ${escape(message.subject)}.`,
    "Please confirm the updated remittance details using the secure link below",
    "before end of business today to avoid service interruption.",
    "",
    "View secure document:",
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620" width="900" height="620" font-family="Segoe UI, Helvetica, Arial, sans-serif">
  <rect width="900" height="620" fill="#f3f4f6"/>
  <rect x="0" y="0" width="900" height="46" fill="#0f172a"/>
  <text x="20" y="29" fill="#e2e8f0" font-size="15">Outlook — Inbox · forensic capture #${index + 1}</text>
  <rect x="24" y="70" width="852" height="34" fill="${banner}" rx="4"/>
  <text x="38" y="92" fill="#fff" font-size="13" font-weight="600">${bannerText}</text>
  <text x="28" y="140" fill="#0f172a" font-size="20" font-weight="700">${escape(message.subject)}</text>
  <text x="28" y="168" fill="#334155" font-size="13">From: ${escape(message.sender)}</text>
  <text x="28" y="188" fill="#334155" font-size="13">To: ${escape((message.recipient as string[])[0])}</text>
  <text x="28" y="208" fill="#64748b" font-size="12">${escape(message.messageTime)} · phish ${escape(message.phishScore)} / spam ${escape(message.spamScore)} / malware ${escape(message.malwareScore)}</text>
  <line x1="28" y1="222" x2="872" y2="222" stroke="#cbd5e1"/>
  ${bodyLines
    .map((line, lineIndex) => `<text x="28" y="${254 + lineIndex * 22}" fill="#1f2937" font-size="14">${line}</text>`)
    .join("\n  ")}
  <rect x="28" y="424" width="360" height="34" fill="#dbeafe" stroke="#1d4fd8" rx="4"/>
  <text x="40" y="446" fill="#1d4fd8" font-size="13">${escape((message.urls as string[])[0]).slice(0, 46)}</text>
  ${
    (message.attachments as unknown[]).length
      ? `<rect x="28" y="480" width="300" height="52" fill="#fff" stroke="#cbd5e1" rx="4"/>
  <text x="44" y="502" fill="#0f172a" font-size="13">📎 ${escape((message.attachments as Record<string, string>[])[0].name)}</text>
  <text x="44" y="521" fill="#b91c1c" font-size="12">verdict: ${escape((message.attachments as Record<string, string>[])[0].malwareVerdict)}</text>`
      : ""
  }
  <text x="28" y="580" fill="#94a3b8" font-size="11">Mock forensic capture · ${escape(message.guid)}</text>
</svg>
`;
}
