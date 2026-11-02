set -eu
cd "$(dirname "$0")/.."
for step in 'Intake' 'Jira webhook' 'Poll Jira' 'Triage' 'Engineering (AI Agent)' 'Validate patch' 'Run isolated tests' 'Publish draft PR' 'Report outcome' 'Demo results'; do
  cp 'Prepare ticket/settings.json' "$step/settings.json"
  cp 'Prepare ticket/common.ts' "$step/common.ts"
done
