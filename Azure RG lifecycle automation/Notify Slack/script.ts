import { sendWithRetry } from "./arm";
import { loadConfig } from "./config";
import { jsonFromStdin } from "./http";
import { audit, log, main } from "./log";

interface Notification {
  kind: string;
  text: string;
  blocks?: unknown[];
}

main("Notify Slack", async () => {
  const note: Notification | null = jsonFromStdin(await Bun.stdin.text());
  if (!note) return;
  log("info", "notify_started", "Preparing Slack notification.", { kind: note.kind });

  const { slack } = loadConfig();
  if (!slack.enabled) {
    log("warn", "slack_disabled", "Slack is disabled in config.json; not posting.", { kind: note.kind });
    audit("slack_message", slack.channel, "skipped", { kind: note.kind, reason: "disabled", text: note.text });
    return;
  }

  const res = await sendWithRetry("POST", "https://slack.com/api/chat.postMessage", {
    channel: slack.channel,
    text: note.text,
    blocks: note.blocks,
    unfurl_links: false,
  });
  const reply: any = await res.json();
  if (!res.ok || !reply.ok) {
    audit("slack_message", slack.channel, "failure", { kind: note.kind, error: reply.error ?? res.status });
    throw new Error(`Slack post failed: ${reply.error ?? res.status}`);
  }
  audit("slack_message", slack.channel, "success", { kind: note.kind, ts: reply.ts });
  log("info", "notify_completed", "Posted Slack message.", { kind: note.kind, channel: slack.channel });
});
