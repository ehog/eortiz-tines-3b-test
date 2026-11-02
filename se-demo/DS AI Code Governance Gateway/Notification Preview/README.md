Renders the Slack message and email that a real deployment would send, and sends nothing.

**Trigger:** upstream [Audit Trail](<../Audit Trail/script.ts>).

Routing is by outcome: bypass attempts go to `#sec-ai-governance-alerts` and the CISO office, successful promotions to `#ai-deployments`, everything else to `#ai-governance-review`. The rendered Slack text is echoed to the step log line by line so it can be read straight out of the run, alongside `event=notify.rendered … delivery=simulated`.
