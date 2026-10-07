Posts the run's digest to the operations team in Slack. Runs after [Create purchase orders](<../Create purchase orders/script.ts>), on every run — including days where nothing needed ordering, so silence always means "the workflow didn't run", never "there was nothing to say".

## Where it posts

`POST https://slack.com/api/chat.postMessage` to **`#eortiz`**, authenticated by the attached Slack connector. To change the channel, edit `CHANNEL` at the top of [script.ts](script.ts).

The bot must be a member of the channel. If it isn't, Slack answers `not_in_channel`, which is logged as an `error` and exits non-zero rather than passing silently.

## The message

A Block Kit message, with a `text` fallback for notifications and screen readers:

- **Header** — how many purchase orders were raised, or that no reorders were needed.
- **Summary fields** — items scored, how many are below their reorder point, how many are urgent, total committed spend.
- **Deliveries received** — purchase orders booked in this run, when there are any.
- **One section per purchase order** — number, supplier, total, expected date, then its lines with a status square (🟥 out of stock, 🟧 critical, 🟨 low), quantity, line cost, and days of cover.
- **Context** — skipped items and why, the check date, the short run id, and a one-line reminder of the reorder-point formula.

Slack caps a message at 50 blocks, so the step shows at most 8 purchase orders and 10 lines each, and says plainly how many it left out — a truncated digest never masquerades as a complete one.

## Audit

Every post writes a record to the `audit` volume with the run id, order count, committed spend, and either the message timestamp or Slack's error code.
