Posts one Slack Block Kit alert per vulnerable package to `#se_demos` (`CHANNEL` constant, Slack connector).

Input: the discovery step's `{ items: [...] }`. Each message carries **Patch Now** and **Postpone** buttons whose URLs point at this workflow's `/patch-decision` route, with the device, package, severity and decision as query parameters. The branch prefix `/__3b/branch/$_3B_BRANCH_ID` is added automatically on drafts.

Output: the items plus the Slack `channel` and `ts` of each message.
