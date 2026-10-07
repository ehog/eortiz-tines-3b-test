Takes the daily snapshot of stock levels that the rest of the workflow reasons about. Runs on a schedule — `0 13 * * 1-5`, 13:00 UTC every weekday — and can also be run by hand from the step's Run button.

It also mints the `runId` that every downstream step logs against, so one run is traceable end to end across all four steps.

## Where the data comes from

The inventory records live in the `inventory_db` volume at `/storage/inventory_db/db.json`, written and read by [store.ts](store.ts). This is a stand-in for an Airtable base: every record is shaped exactly like Airtable's REST response (`{ id, createdTime, fields }`) with human field names — `SKU`, `On Hand`, `Avg Daily Usage`, `Lead Time Days` — so pointing this at a real base means rewriting `store.ts` alone. See the workflow README for that swap.

On first run the store is empty, so the step seeds 19 SKUs across five suppliers plus one purchase order already in flight.

## What it does on each run

1. **Books in deliveries.** Any purchase order still `Open` whose `Expected On` date has passed is marked `Received`: its quantities move from `On Order` to `On Hand`.
2. **Draws down stock.** For each day elapsed since the last check it consumes roughly `Avg Daily Usage` units per item, with a per-SKU-per-day jitter so re-running on the same day never double-consumes. Discontinued items are left alone.
3. **Publishes the snapshot.** The updated store is written back, and the full item list goes to stdout for [Calculate reorder points](<../Calculate reorder points/script.ts>).

Steps 1 and 2 are the simulation half. Against a real base you would delete them and just read.

## Output

```json
{ "runId": "…", "checkedAt": "…", "seeded": false, "elapsedDays": 1, "received": [], "items": [ { "id": "recINV00001", "fields": { … } } ] }
```

The `inventory_db` volume is mounted `concurrency=exclusive` because this step read-modify-writes one shared JSON file.
