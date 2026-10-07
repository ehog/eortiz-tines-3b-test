import { audit, makeLogger } from "./log";
import { readDb, writeDb, type PoLine, type PurchaseOrder } from "./store";

const STEP = "Create purchase orders";
const startedAt = Date.now();

type Analysis = {
  recordId: string;
  sku: string;
  name: string;
  supplier: string;
  supplierEmail: string;
  unitCost: number;
  available: number;
  reorderPoint: number;
  daysOfCover: number | null;
  status: string;
  leadTimeDays: number;
  suggestedQty: number;
  estimatedCost: number;
  reason: string;
};

type Input = {
  runId: string;
  checkedAt: string;
  received: Array<{ poNumber: string; supplier: string; lines: number; units: number }>;
  summary: Record<string, number>;
  items: Analysis[];
  reorder: Analysis[];
};

const input = JSON.parse(await Bun.stdin.text()) as Input;
const log = makeLogger(STEP, input.runId);

log("info", "po_generation_started", "Grouping items below their reorder point into supplier orders.", {
  reorder_candidates: input.reorder.length,
});

const db = await readDb();
if (!db) {
  log("error", "store_missing", "Inventory store is missing; cannot raise purchase orders.", {});
  process.exit(1);
}

const itemBySku = new Map(db.items.map((i) => [i.fields.SKU, i]));
const openLineSkus = new Set(
  db.poLines.filter((l) => l.fields.Status === "Open").map((l) => l.fields.SKU),
);

const day = new Date(input.checkedAt).toISOString().slice(0, 10).replace(/-/g, "");
const supplierCode = (name: string) =>
  name.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4) || "SUPP";

const bySupplier = new Map<string, Analysis[]>();
const skipped: Array<{ sku: string; reason: string }> = [];

for (const a of input.reorder) {
  if (a.suggestedQty <= 0) {
    skipped.push({ sku: a.sku, reason: "suggested quantity resolved to zero" });
    log("warn", "line_skipped", "Suggested order quantity is zero; nothing to raise.", { sku: a.sku });
    continue;
  }
  if (openLineSkus.has(a.sku)) {
    skipped.push({ sku: a.sku, reason: "already on an open purchase order" });
    log("warn", "line_skipped", "Item is already on an open purchase order.", { sku: a.sku });
    continue;
  }
  if (!itemBySku.has(a.sku)) {
    skipped.push({ sku: a.sku, reason: "no longer present in the inventory base" });
    log("warn", "line_skipped", "Item disappeared from the base between read and order.", { sku: a.sku });
    continue;
  }
  const list = bySupplier.get(a.supplier);
  if (list) list.push(a);
  else bySupplier.set(a.supplier, [a]);
}

type CreatedPo = {
  poNumber: string;
  supplier: string;
  supplierEmail: string;
  orderedOn: string;
  expectedOn: string;
  totalCost: number;
  lines: Array<{
    sku: string;
    name: string;
    quantity: number;
    unitCost: number;
    lineCost: number;
    reason: string;
    status: string;
    daysOfCover: number | null;
  }>;
};

const created: CreatedPo[] = [];
const round2 = (n: number) => Math.round(n * 100) / 100;
let nextLineSeq = db.poLines.length + 1;

for (const [supplier, lines] of bySupplier) {
  const poNumber = `PO-${day}-${supplierCode(supplier)}`;

  if (db.purchaseOrders.some((p) => p.fields["PO Number"] === poNumber)) {
    for (const l of lines) skipped.push({ sku: l.sku, reason: `${poNumber} was already raised today` });
    log("warn", "po_skipped", "A purchase order for this supplier already exists today.", {
      po_number: poNumber,
      supplier,
      lines: lines.length,
    });
    continue;
  }

  const orderedOn = input.checkedAt;
  const leadTimeDays = Math.max(...lines.map((l) => l.leadTimeDays));
  const expectedOn = new Date(
    new Date(orderedOn).getTime() + leadTimeDays * 86_400_000,
  ).toISOString();
  const totalCost = round2(lines.reduce((n, l) => n + l.suggestedQty * l.unitCost, 0));

  const po: PurchaseOrder = {
    id: `recPO${String(db.nextPoSeq).padStart(6, "0")}`,
    createdTime: orderedOn,
    fields: {
      "PO Number": poNumber,
      Supplier: supplier,
      "Supplier Email": lines[0].supplierEmail,
      Status: "Open",
      "Ordered On": orderedOn,
      "Expected On": expectedOn,
      "Line Count": lines.length,
      "Total Cost": totalCost,
      "Raised By": "Inventory Reorder Monitor",
      "Run Id": input.runId,
    },
  };
  db.nextPoSeq++;
  db.purchaseOrders.push(po);

  const poLines: PoLine[] = lines.map((l) => ({
    id: `recPOL${String(nextLineSeq++).padStart(6, "0")}`,
    createdTime: orderedOn,
    fields: {
      "PO Number": poNumber,
      SKU: l.sku,
      "Item Name": l.name,
      Quantity: l.suggestedQty,
      "Unit Cost": l.unitCost,
      "Line Cost": round2(l.suggestedQty * l.unitCost),
      Status: "Open",
      Reason: l.reason,
    },
  }));
  db.poLines.push(...poLines);

  for (const l of lines) {
    const item = itemBySku.get(l.sku)!;
    item.fields["On Order"] += l.suggestedQty;
  }

  created.push({
    poNumber,
    supplier,
    supplierEmail: po.fields["Supplier Email"],
    orderedOn,
    expectedOn,
    totalCost,
    lines: lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      quantity: l.suggestedQty,
      unitCost: l.unitCost,
      lineCost: round2(l.suggestedQty * l.unitCost),
      reason: l.reason,
      status: l.status,
      daysOfCover: l.daysOfCover,
    })),
  });
}

await writeDb(db);

for (const po of created) {
  await audit({
    step: STEP,
    run_id: input.runId,
    action: "purchase_order_created",
    target: `po:${po.poNumber}`,
    outcome: "success",
    detail: {
      supplier: po.supplier,
      lines: po.lines.length,
      total_cost: po.totalCost,
      expected_on: po.expectedOn,
    },
  });
}
for (const s of skipped) {
  await audit({
    step: STEP,
    run_id: input.runId,
    action: "purchase_order_line_skipped",
    target: `sku:${s.sku}`,
    outcome: "skipped",
    detail: { reason: s.reason },
  });
}

log("info", "po_generation_completed", "Purchase orders raised.", {
  purchase_orders: created.length,
  lines: created.reduce((n, p) => n + p.lines.length, 0),
  skipped: skipped.length,
  committed_spend: round2(created.reduce((n, p) => n + p.totalCost, 0)),
  duration_ms: Date.now() - startedAt,
});

console.log(
  JSON.stringify({
    runId: input.runId,
    checkedAt: input.checkedAt,
    received: input.received,
    summary: input.summary,
    items: input.items,
    purchaseOrders: created,
    skipped,
  }),
);
