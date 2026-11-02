#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for step in 'Receive PagerDuty' 'Receive Slack' 'Read queue' 'Fetch context' 'Route assessment' 'Claim notifications' 'Deliver Slack' 'Record delivery' 'Check deadlines' 'Investigate (AI Agent)' 'Replay demo' 'Verify controls'; do
  cp 'Review and replay/common.ts' "$step/common.ts"
  cp 'Review and replay/settings.json' "$step/settings.json"
done
