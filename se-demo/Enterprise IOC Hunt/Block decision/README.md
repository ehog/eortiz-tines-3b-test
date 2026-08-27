`GET /ioc/api/block-decision?hunt=…&token=…&decision=approve|deny` (space auth) — the target of the Approve / Deny buttons in the Slack message.

Rejects a mismatched approval token, reports an already-decided request without changing it, and otherwise records the decision, timestamp and the approver's `x-3b-authenticated-email`. Responds with a styled confirmation page.

The response carries `X-Ioc-Hunt-Id`, `X-Ioc-Decision` and `X-Ioc-Approver` headers, which is how [Submit block request](<../Submit block request/script.ts>) learns the outcome from this step's stdout.
