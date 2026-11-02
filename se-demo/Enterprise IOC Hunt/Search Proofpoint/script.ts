import { intBetween, offsetIso, pick } from "./lib";
import { runSearch } from "./search";

const SENDERS = [
  "billing@invoice-secure-portal.com",
  "no-reply@docs-sharepoint-review.net",
  "hr.notice@benefits-update.co",
  "support@delivery-tracking-alerts.com",
];

const RECIPIENTS = [
  "j.mercer@corp.example.com",
  "d.okafor@corp.example.com",
  "ap-team@corp.example.com",
  "s.raymond@corp.example.com",
  "exec-assist@corp.example.com",
];

const SUBJECTS = [
  "ACTION REQUIRED: Outstanding invoice 84120",
  "Shared document: Q2 payroll review",
  "Your benefits enrollment expires today",
  "Delivery attempt failed - confirm address",
  "RE: Wire instructions update",
];

await runSearch("proofpoint", 1400, ({ indicator, type, baseIso, next }) => {
  const count = intBetween(next, 1, 5);
  const messages = Array.from({ length: count }, (_, i) => {
    const verdict = pick(next, ["blocked", "delivered", "quarantined", "delivered"]);
    return {
      messageId: `<${(Math.floor(next() * 0xffffffff) + 0x10000000).toString(16)}.${intBetween(next, 100, 999)}@mx.corp.example.com>`,
      guid: `pp_${(Math.floor(next() * 0xfffffff) + 0x1000000).toString(16)}`,
      sender: pick(next, SENDERS),
      senderIp: `${intBetween(next, 45, 209)}.${intBetween(next, 1, 254)}.${intBetween(next, 1, 254)}.${intBetween(next, 1, 254)}`,
      recipients: [RECIPIENTS[(intBetween(next, 0, RECIPIENTS.length - 1) + i) % RECIPIENTS.length]!],
      subject: pick(next, SUBJECTS),
      messageTime: offsetIso(baseIso, intBetween(next, 60, 10080) + i),
      verdict,
      clicked: verdict === "delivered" ? next() < 0.4 : false,
      threatType: type === "sha1" || type === "sha256" ? "attachment" : type === "url" ? "url" : "sender/impostor",
      matchedOn: indicator,
      quarantineFolder: verdict === "quarantined" ? "Threat Quarantine" : null,
    };
  });

  const users = [...new Set(messages.flatMap((m) => m.recipients))].map((upn) => ({
    upn,
    vap: next() < 0.35,
    clicksLast30d: intBetween(next, 0, 4),
  }));

  const stamps = messages.map((m) => m.messageTime).sort();

  return {
    findings: {
      cluster: "corp_hosted",
      messages,
      users,
      blocked: messages.filter((m) => m.verdict === "blocked").length,
      delivered: messages.filter((m) => m.verdict === "delivered").length,
      quarantined: messages.filter((m) => m.verdict === "quarantined").length,
      clicksPermitted: messages.filter((m) => m.clicked).length,
    },
    frequency: messages.length,
    firstSeen: stamps[0]!,
    lastSeen: stamps[stamps.length - 1]!,
  };
});
