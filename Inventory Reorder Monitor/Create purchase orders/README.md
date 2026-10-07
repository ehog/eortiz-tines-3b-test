Turns the flagged items from [Calculate reorder points](<../Calculate reorder points/script.ts>) into purchase orders — one header per supplier, one line per SKU — and writes them back to the inventory store.

This is the step that changes state. It raises orders and moves stock into `On Order`, so it writes an audit record for every order raised and every line skipped.

## Grouping and numbering

Items are grouped by `Supplier`. Each group becomes one purchase order numbered:

```
PO-<YYYYMMDD>-<first four letters of the supplier>     e.g. PO-20260820-RIDG
```

The number is derived, not sequential, which is what makes the step **idempotent**: re-running on the same day finds the existing PO number in the store and skips the whole group rather than raising a duplicate.

`Expected On` is the order date plus the longest lead time on the order.

## What gets skipped

A line is dropped, with a `warn` and an audit record, when it:

- resolved to a zero suggested quantity,
- is already sitting on an open purchase order,
- vanished from the base between the read and the order.

## Writes

Into `/storage/inventory_db/db.json`:

- a record in `purchaseOrders` (`PO Number`, `Supplier`, `Status: Open`, `Ordered On`, `Expected On`, `Line Count`, `Total Cost`, `Run Id`)
- one record per SKU in `poLines`
- `On Order` incremented on each ordered item, so the next run nets it off instead of ordering again

[Read inventory](<../Read inventory/script.ts>) is what later closes these out, moving `On Order` into `On Hand` once `Expected On` passes.

The volume is `concurrency=exclusive` — this is a read-modify-write of one shared file, and two concurrent runs must not both raise the same order.

## Output

Everything the notifier needs, whether or not anything was ordered:

```json
{ "runId": "…", "checkedAt": "…", "received": [], "summary": { … }, "items": [ … ], "purchaseOrders": [ … ], "skipped": [ … ] }
```

`purchaseOrders` is an empty array on a clean day — the step deliberately still emits output so the digest goes out either way.

## Sending the orders to suppliers

Nothing here emails anybody; each PO carries a `Supplier Email`, so the natural extension is a step downstream of this one that sends the order. Add it as a second entry in `links`.
