import { makeLogger } from "./log";
import { jitter, readDb, seed, writeDb, type Db, type PurchaseOrder } from "./store";

const STEP = "Read inventory";
const runId = crypto.randomUUID();
const log = makeLogger(STEP, runId);
const startedAt = Date.now();

log("info", "read_started", "Reading current stock levels from the inventory base.");

let db = await readDb();
let seeded = false;
if (!db) {
  db = seed();
  seeded = true;
  log("info", "base_seeded", "No inventory store found; seeded the demo base.", {
    items: db.items.length,
    purchase_orders: db.purchaseOrders.length,
  });
}

const now = new Date();
const elapsedDays = Math.max(
  0,
  Math.floor((now.getTime() - new Date(db.lastCheckedAt).getTime()) / 86_400_000),
);

const bySku = new Map(db.items.map((i) => [i.fields.SKU, i]));

const received: Array<{ poNumber: string; supplier: string; lines: number; units: number }> = [];
for (const po of db.purchaseOrders) {
  if (po.fields.Status !== "Open") continue;
  if (new Date(po.fields["Expected On"]).getTime() > now.getTime()) continue;

  let units = 0;
  let lines = 0;
  for (const line of db.poLines) {
    if (line.fields["PO Number"] !== po.fields["PO Number"] || line.fields.Status !== "Open") continue;
    const item = bySku.get(line.fields.SKU);
    if (!item) {
      log("warn", "receipt_skipped", "PO line references a SKU that is no longer in the base.", {
        po_number: po.fields["PO Number"],
        sku: line.fields.SKU,
      });
      continue;
    }
    item.fields["On Order"] = Math.max(0, item.fields["On Order"] - line.fields.Quantity);
    item.fields["On Hand"] += line.fields.Quantity;
    line.fields.Status = "Received";
    units += line.fields.Quantity;
    lines++;
  }
  po.fields.Status = "Received";
  received.push({ poNumber: po.fields["PO Number"], supplier: po.fields.Supplier, lines, units });
}

if (received.length) {
  log("info", "deliveries_received", "Booked in purchase orders that reached their expected date.", {
    purchase_orders: received.length,
    units: received.reduce((n, r) => n + r.units, 0),
  });
}

let consumedUnits = 0;
if (elapsedDays > 0) {
  const dayKey = now.toISOString().slice(0, 10);
  for (const item of db.items) {
    if (item.fields.Discontinued) continue;
    const draw = Math.round(
      item.fields["Avg Daily Usage"] * elapsedDays * jitter(`${item.fields.SKU}:${dayKey}`),
    );
    const taken = Math.min(draw, item.fields["On Hand"]);
    if (taken < draw) {
      log("warn", "stock_exhausted", "Demand exceeded stock on hand; item is short.", {
        sku: item.fields.SKU,
        requested: draw,
        available: item.fields["On Hand"],
      });
    }
    item.fields["On Hand"] -= taken;
    consumedUnits += taken;
  }
}

db.lastCheckedAt = now.toISOString();
await writeDb(db satisfies Db);

const payload = {
  runId,
  checkedAt: now.toISOString(),
  seeded,
  elapsedDays,
  received,
  items: db.items,
};

log("info", "read_completed", "Current stock levels captured.", {
  items: db.items.length,
  elapsed_days: elapsedDays,
  consumed_units: consumedUnits,
  open_purchase_orders: db.purchaseOrders.filter((p: PurchaseOrder) => p.fields.Status === "Open").length,
  duration_ms: Date.now() - startedAt,
});

console.log(JSON.stringify(payload));
