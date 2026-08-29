import { getConfig, openWritable, logEvent, truncate } from "./soclib";

type DigestPayload = {
  digestId: number;
  subject: string;
  html: string;
  markdown: string;
  delivery: { emailTo: string };
  /** Set by a manual resend to send even when digest email notifications are off. */
  force?: boolean;
  /** Set by a manual resend to pick channels; absent means every enabled channel. */
  channels?: string[];
};

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("No digest payload on stdin.");
  process.exit(1);
}
const digest = JSON.parse(raw) as DigestPayload;
const to = digest.delivery.emailTo;

if (Array.isArray(digest.channels) && !digest.channels.includes("email")) {
  console.error(`Digest #${digest.digestId}: email not requested by this run.`);
  process.exit(0);
}

{
  const db = openWritable();
  const enabled = getConfig(db).notifications.digestEmail;
  if (!enabled && digest.force !== true) {
    const status = "skipped: digest email notifications disabled";
    db.query("UPDATE digests SET email_status = ? WHERE id = ?").run(status, digest.digestId);
    logEvent(db, new Date().toISOString(), "digest:email", `Digest #${digest.digestId} email skipped: notifications disabled`, {
      digestId: digest.digestId,
      status,
    });
    db.close();
    console.error(`Digest #${digest.digestId}: email skipped, digest email notifications are disabled.`);
    console.log(JSON.stringify({ digestId: digest.digestId, emailTo: to, skipped: true, reason: "notifications_disabled" }));
    process.exit(0);
  }
  db.close();
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

const boundary = `soc-digest-${digest.digestId}-${Date.now().toString(36)}`;
const mime = [
  `To: ${to}`,
  `Subject: ${encodeHeader(digest.subject)}`,
  "MIME-Version: 1.0",
  `Content-Type: multipart/alternative; boundary="${boundary}"`,
  "",
  `--${boundary}`,
  "Content-Type: text/plain; charset=UTF-8",
  "",
  digest.markdown,
  "",
  `--${boundary}`,
  "Content-Type: text/html; charset=UTF-8",
  "",
  digest.html,
  "",
  `--${boundary}--`,
  "",
].join("\r\n");

const rawMessage = Buffer.from(mime, "utf8").toString("base64url");

const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ raw: rawMessage }),
});
const bodyText = await res.text();

const db = openWritable();
const status = res.ok ? "sent" : `failed: ${res.status} ${truncate(bodyText, 300)}`;
db.query("UPDATE digests SET email_status = ? WHERE id = ?").run(status, digest.digestId);
logEvent(db, new Date().toISOString(), "digest:email", `Digest #${digest.digestId} email to ${to}: ${res.ok ? "sent" : "failed"}`, {
  digestId: digest.digestId,
  status,
});
db.close();

if (!res.ok) {
  console.error(`Gmail send failed: ${res.status} ${truncate(bodyText, 500)}`);
  process.exit(1);
}

const messageId = (JSON.parse(bodyText) as { id?: string }).id ?? "unknown";
console.error(`Digest #${digest.digestId} emailed to ${to} (Gmail message ${messageId}).`);
console.log(JSON.stringify({ digestId: digest.digestId, emailTo: to, messageId }));
