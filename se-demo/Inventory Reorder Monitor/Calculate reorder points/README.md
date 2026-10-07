Scores every stocked item against its own reorder point. Pure arithmetic — no external calls, no stored state. Runs whenever [Read inventory](<../Read inventory/script.ts>) publishes a snapshot.

## The maths

For each item, per unit of time in days:

```
available        = On Hand + On Order − Allocated
lead time demand = Avg Daily Usage × Lead Time Days
safety stock     = Avg Daily Usage × Safety Stock Days
reorder point    = lead time demand + safety stock
target level     = reorder point + Avg Daily Usage × Review Period Days
days of cover    = available ÷ Avg Daily Usage
```

`available` nets off stock already promised to orders and counts stock already on its way, so an item with an open purchase order doesn't get ordered twice.

## Status bands

| Status | Condition | Meaning |
|---|---|---|
| `out_of_stock` | `available ≤ 0` | Nothing free to ship |
| `critical` | `available ≤ lead time demand` | Will run out before a replacement can land |
| `low` | `available ≤ reorder point` | Below the reorder point but the buffer holds |
| `healthy` | above the reorder point | No action |

Anything other than `healthy` is flagged `needsReorder`.

## Suggested order quantity

Order back up to the target level, then respect the supplier's commercial terms:

```
suggestedQty = ceil( max(target level − available, Min Order Qty) ÷ Pack Size ) × Pack Size
```

## Skips

Two classes of item are dropped with a `warn` on stderr rather than scored: **discontinued** items, and items with **no recorded usage** (their reorder point is undefined — dividing by zero usage would report infinite cover). The counts land in the run summary and in the Slack digest.

## Output

Passes through `runId`, `checkedAt` and `received`, and adds:

- `summary` — counts per status, plus `reorderCount` and `estimatedSpend`
- `items` — every scored item with its full working
- `reorder` — just the items needing action, sorted most-urgent first

To change the formula, edit [script.ts](script.ts); nothing downstream depends on how the numbers were derived.
